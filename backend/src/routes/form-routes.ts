import { Hono } from 'hono';
import { db, formRoutes, signingPackets, recipients, auditLogs, processedSubmissions, eq, desc } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { generateSecureToken, getTokenExpiryDate, generateSigningUrl } from '../utils/token.js';
import { parseTemplatePlaceholdersFromBuffer, Placeholder } from '../services/pdf.service.js';
import { sendSigningRequest } from '../services/email.service.js';
import * as gdrive from '../services/google-drive.service.js';
import { uploadFile } from '../utils/storage.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const formRouteSchema = z.object({
  jotformFormId: z.string().min(1),
  formName: z.string().min(1),
  signerEmail: z.string().email().optional().or(z.literal('')),
  signerName: z.string().min(1).optional().or(z.literal('')),
  signerRole: z.string().min(1).optional(),
  driveFolderId: z.string().optional(),
  sharepointFolder: z.string().optional(),
  isActive: z.boolean().optional(),
});

const updateFormRouteSchema = formRouteSchema.partial();

export const formRouteRoutes = new Hono();

formRouteRoutes.use('*', requireAdmin);

// List all form routes
formRouteRoutes.get('/', async (c) => {
  const routes = await db.query.formRoutes.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
  return c.json(routes);
});

// Get single form route
formRouteRoutes.get('/:id', async (c) => {
  const route = await db.query.formRoutes.findFirst({
    where: eq(formRoutes.id, c.req.param('id')),
  });
  if (!route) return c.json({ error: 'Form route not found' }, 404);
  return c.json(route);
});

// Create form route
formRouteRoutes.post('/', async (c) => {
  const validation = formRouteSchema.safeParse(await c.req.json());
  if (!validation.success) {
    return c.json({ error: 'Validation failed', details: validation.error.errors }, 400);
  }

  const { jotformFormId, formName, signerEmail, signerName, signerRole, driveFolderId, sharepointFolder } = validation.data;

  const existing = await db.query.formRoutes.findFirst({
    where: eq(formRoutes.jotformFormId, jotformFormId),
  });
  if (existing) {
    return c.json({ error: 'A route for this JotForm ID already exists' }, 409);
  }

  const [route] = await db.insert(formRoutes).values({
    jotformFormId,
    formName,
    signerEmail: signerEmail || null,
    signerName: signerName || null,
    signerRole: signerRole || 'countersigner',
    driveFolderId: driveFolderId || null,
    sharepointFolder: sharepointFolder || null,
  }).returning();

  return c.json(route);
});

// Update form route
formRouteRoutes.patch('/:id', async (c) => {
  const validation = updateFormRouteSchema.safeParse(await c.req.json());
  if (!validation.success) {
    return c.json({ error: 'Validation failed', details: validation.error.errors }, 400);
  }

  const route = await db.query.formRoutes.findFirst({
    where: eq(formRoutes.id, c.req.param('id')),
  });
  if (!route) return c.json({ error: 'Form route not found' }, 404);

  const [updated] = await db.update(formRoutes)
    .set(validation.data)
    .where(eq(formRoutes.id, c.req.param('id')))
    .returning();

  return c.json(updated);
});

// Delete form route
formRouteRoutes.delete('/:id', async (c) => {
  const route = await db.query.formRoutes.findFirst({
    where: eq(formRoutes.id, c.req.param('id')),
  });
  if (!route) return c.json({ error: 'Form route not found' }, 404);

  await db.delete(formRoutes).where(eq(formRoutes.id, c.req.param('id')));
  return c.json({ success: true });
});

// Pull new PDFs from Google Drive
formRouteRoutes.post('/:id/pull', async (c) => {
  const route = await db.query.formRoutes.findFirst({
    where: eq(formRoutes.id, c.req.param('id')),
  });
  if (!route) return c.json({ error: 'Form route not found' }, 404);

  if (!route.driveFolderId) {
    return c.json({ error: 'No Google Drive folder configured for this form route' }, 400);
  }

  const connected = await gdrive.isConnected();
  if (!connected) {
    return c.json({ error: 'Google Drive not connected. Please authorize first.' }, 400);
  }

  const days = Math.min(Math.max(parseInt(c.req.query('days') || '7', 10) || 7, 1), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    const files = await gdrive.listFiles(route.driveFolderId, since);

    for (const file of files) {
      const existing = await db.query.processedSubmissions.findFirst({
        where: eq(processedSubmissions.driveFileId, file.id),
      });
      if (existing) { skipped++; continue; }

      try {
        const pdfBuffer = await gdrive.downloadFile(file.id);
        const employeeName = extractNameFromFilename(file.name, route.formName);

        const packetId = uuidv4();
        const fileId = uuidv4();
        const originalFileName = file.name;
        const storedFileName = `${fileId}_${originalFileName}`;
        const storageKey = `packets/${packetId}/${storedFileName}`;

        await uploadFile(storageKey, pdfBuffer);

        let placeholders: Placeholder[] = [];
        try {
          placeholders = await parseTemplatePlaceholdersFromBuffer(pdfBuffer);
        } catch (err) {
          console.error(`[Pull] Placeholder parse error for ${file.name}:`, err);
        }

        const packetName = `${route.formName} - ${employeeName || file.name.replace(/\.pdf$/i, '')}`;
        const hasSigner = !!(route.signerEmail && route.signerName);
        const token = generateSecureToken();
        const tokenExpiresAt = getTokenExpiryDate();

        // Packet, recipient and the processed marker are written together so a
        // failure part-way never leaves a packet that gets re-created on the next pull.
        const recipientId = await db.transaction(async (tx) => {
          await tx.insert(signingPackets).values({
            id: packetId,
            name: packetName,
            fileName: originalFileName,
            filePath: storageKey,
            placeholders: JSON.stringify(placeholders),
            status: hasSigner ? 'sent' : 'pending_assignment',
            employeeName: employeeName || null,
            formRouteId: route.id,
          });

          let recId: string | null = null;
          if (hasSigner) {
            const [rec] = await tx.insert(recipients).values({
              packetId,
              roleName: route.signerRole,
              name: route.signerName!,
              email: route.signerEmail!,
              order: 1,
              token,
              tokenExpiresAt,
              status: 'notified',
            }).returning();
            recId = rec.id;
          }

          await tx.insert(processedSubmissions).values({
            submissionId: file.id, formId: route.id, packetId, driveFileId: file.id,
          });
          return recId;
        });

        await db.insert(auditLogs).values({
          packetId, action: 'created',
          details: `Pulled from Google Drive (${file.name})${hasSigner ? '' : ' - pending assignment'}` +
            (placeholders.length === 0 ? ' - WARNING: no signature tags detected in PDF' : ''),
        });

        if (hasSigner && recipientId) {
          try {
            await sendSigningRequest(route.signerEmail!, route.signerName!, packetName, generateSigningUrl(token), tokenExpiresAt);
            await db.insert(auditLogs).values({
              packetId, recipientId, action: 'sent', details: `Signing request sent to ${route.signerEmail}`,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${file.name}: packet created but email failed (${msg}) - use Resend`);
            await db.insert(auditLogs).values({
              packetId, recipientId, action: 'email_failed', details: `Signing email to ${route.signerEmail} failed: ${msg}`,
            });
          }
        }

        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${file.name}: ${msg}`);
      }
    }

    return c.json({ success: true, total: files.length, created, skipped, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to access Google Drive: ${msg}` }, 502);
  }
});

function extractNameFromFilename(filename: string, formName: string): string | null {
  const base = filename.replace(/\.pdf$/i, '').trim();

  if (base.includes(' - ')) {
    const parts = base.split(' - ');
    if (parts[0].trim().toLowerCase().startsWith(formName.toLowerCase().substring(0, 10))) {
      const name = parts.slice(1).join(' - ').trim();
      if (name) return name;
    }
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].trim().toLowerCase().startsWith(formName.toLowerCase().substring(0, 10))) {
        const name = parts.slice(0, i).join(' - ').trim();
        if (name) return name;
      }
    }
    const name = parts.slice(1).join(' - ').trim();
    if (name) return name;
  }

  return null;
}
