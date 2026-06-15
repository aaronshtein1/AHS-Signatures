import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { generateSecureToken, getTokenExpiryDate, generateSigningUrl } from '../utils/token.js';
import { parseTemplatePlaceholders, Placeholder } from '../services/pdf.service.js';
import { sendSigningRequest } from '../services/email.service.js';
import * as gdrive from '../services/google-drive.service.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
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

export const formRouteRoutes: FastifyPluginAsync = async (fastify) => {
  // All routes require admin
  fastify.addHook('preHandler', requireAdmin);

  // List all form routes
  fastify.get('/', async () => {
    return prisma.formRoute.findMany({
      orderBy: { createdAt: 'desc' },
    });
  });

  // Get single form route
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const route = await prisma.formRoute.findUnique({
      where: { id: request.params.id },
    });

    if (!route) {
      return reply.status(404).send({ error: 'Form route not found' });
    }

    return route;
  });

  // Create form route
  fastify.post('/', async (request, reply) => {
    const validation = formRouteSchema.safeParse(request.body);

    if (!validation.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { jotformFormId, formName, signerEmail, signerName, signerRole, driveFolderId, sharepointFolder } = validation.data;

    // Check for duplicate form ID
    const existing = await prisma.formRoute.findUnique({
      where: { jotformFormId },
    });

    if (existing) {
      return reply.status(409).send({ error: 'A route for this JotForm ID already exists' });
    }

    const route = await prisma.formRoute.create({
      data: {
        jotformFormId,
        formName,
        signerEmail: signerEmail || null,
        signerName: signerName || null,
        signerRole: signerRole || 'countersigner',
        driveFolderId: driveFolderId || null,
        sharepointFolder: sharepointFolder || null,
      },
    });

    return route;
  });

  // Update form route
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const validation = updateFormRouteSchema.safeParse(request.body);

    if (!validation.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const route = await prisma.formRoute.findUnique({
      where: { id: request.params.id },
    });

    if (!route) {
      return reply.status(404).send({ error: 'Form route not found' });
    }

    const updated = await prisma.formRoute.update({
      where: { id: request.params.id },
      data: validation.data,
    });

    return updated;
  });

  // Delete form route
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const route = await prisma.formRoute.findUnique({
      where: { id: request.params.id },
    });

    if (!route) {
      return reply.status(404).send({ error: 'Form route not found' });
    }

    await prisma.formRoute.delete({
      where: { id: request.params.id },
    });

    return { success: true };
  });

  // Pull new PDFs from Google Drive for a form route
  fastify.post<{ Params: { id: string }; Querystring: { days?: string } }>(
    '/:id/pull',
    async (request, reply) => {
      const route = await prisma.formRoute.findUnique({
        where: { id: request.params.id },
      });

      if (!route) {
        return reply.status(404).send({ error: 'Form route not found' });
      }

      if (!route.driveFolderId) {
        return reply.status(400).send({ error: 'No Google Drive folder configured for this form route' });
      }

      const connected = await gdrive.isConnected();
      if (!connected) {
        return reply.status(400).send({ error: 'Google Drive not connected. Please authorize first.' });
      }

      // Calculate "since" date from days parameter
      const days = parseInt((request.query as any).days || '7', 10);
      const since = new Date();
      since.setDate(since.getDate() - days);

      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      try {
        const files = await gdrive.listFiles(route.driveFolderId, since);

        for (const file of files) {
          // Skip if already processed (by Drive file ID)
          const existing = await prisma.processedSubmission.findFirst({
            where: { driveFileId: file.id },
          });
          if (existing) {
            skipped++;
            continue;
          }

          try {
            // Download PDF from Google Drive
            const pdfBuffer = await gdrive.downloadFile(file.id);

            // Extract employee name from filename
            // JotForm typically names files like "FormName - FirstName LastName.pdf"
            const employeeName = extractNameFromFilename(file.name, route.formName);

            // Save PDF locally
            const packetId = uuidv4();
            const fileId = uuidv4();
            const safeName = route.formName.replace(/[^a-zA-Z0-9-_ ]/g, '');
            const originalFileName = file.name;
            const storedFileName = `${fileId}_${originalFileName}`;
            const packetDir = path.join(process.cwd(), 'uploads', 'packets', packetId);

            await fs.mkdir(packetDir, { recursive: true });
            await fs.writeFile(path.join(packetDir, storedFileName), pdfBuffer);

            // Parse placeholders from PDF
            let placeholders: Placeholder[] = [];
            try {
              placeholders = await parseTemplatePlaceholders(path.join(packetDir, storedFileName));
            } catch (err) {
              console.error(`[Pull] Placeholder parse error for ${file.name}:`, err);
            }

            if (route.signerEmail && route.signerName) {
              // Auto-assign: signer is configured
              const token = generateSecureToken();
              const tokenExpiresAt = getTokenExpiryDate();

              const packet = await prisma.signingPacket.create({
                data: {
                  id: packetId,
                  name: `${route.formName} - ${employeeName || file.name.replace('.pdf', '')}`,
                  fileName: originalFileName,
                  filePath: `packets/${packetId}/${storedFileName}`,
                  placeholders: JSON.stringify(placeholders),
                  status: 'sent',
                  employeeName: employeeName || null,
                  formRouteId: route.id,
                  recipients: {
                    create: {
                      roleName: route.signerRole,
                      name: route.signerName,
                      email: route.signerEmail,
                      order: 1,
                      token,
                      tokenExpiresAt,
                      status: 'notified',
                    },
                  },
                },
                include: { recipients: true },
              });

              // Send signing email
              const signingUrl = generateSigningUrl(token);
              await sendSigningRequest(
                route.signerEmail,
                route.signerName,
                packet.name,
                signingUrl,
                tokenExpiresAt
              );

              // Audit logs
              await prisma.auditLog.create({
                data: {
                  packetId,
                  action: 'created',
                  details: `Pulled from Google Drive (${file.name})`,
                },
              });
              await prisma.auditLog.create({
                data: {
                  packetId,
                  recipientId: packet.recipients[0].id,
                  action: 'sent',
                  details: `Signing request sent to ${route.signerEmail}`,
                },
              });
            } else {
              // Unassigned: no signer configured
              await prisma.signingPacket.create({
                data: {
                  id: packetId,
                  name: `${route.formName} - ${employeeName || file.name.replace('.pdf', '')}`,
                  fileName: originalFileName,
                  filePath: `packets/${packetId}/${storedFileName}`,
                  placeholders: JSON.stringify(placeholders),
                  status: 'pending_assignment',
                  employeeName: employeeName || null,
                  formRouteId: route.id,
                },
              });

              await prisma.auditLog.create({
                data: {
                  packetId,
                  action: 'created',
                  details: `Pulled from Google Drive (${file.name}) - pending assignment`,
                },
              });
            }

            // Mark as processed
            await prisma.processedSubmission.create({
              data: {
                submissionId: file.id, // Use Drive file ID as submission ID
                formId: route.id,
                packetId,
                driveFileId: file.id,
              },
            });

            created++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${file.name}: ${msg}`);
          }
        }

        return {
          success: true,
          total: files.length,
          created,
          skipped,
          errors,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({ error: `Failed to access Google Drive: ${msg}` });
      }
    }
  );
};

/**
 * Extract employee name from a Google Drive filename.
 * JotForm typically names files like "FormName - FirstName LastName.pdf"
 * or "FirstName LastName - FormName.pdf"
 */
function extractNameFromFilename(filename: string, formName: string): string | null {
  // Remove .pdf extension
  const base = filename.replace(/\.pdf$/i, '').trim();

  // Try "FormName - EmployeeName" pattern
  if (base.includes(' - ')) {
    const parts = base.split(' - ');
    // If the form name matches the first part, employee is the rest
    if (parts[0].trim().toLowerCase().startsWith(formName.toLowerCase().substring(0, 10))) {
      const name = parts.slice(1).join(' - ').trim();
      if (name) return name;
    }
    // If form name matches later part, employee is the first part
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].trim().toLowerCase().startsWith(formName.toLowerCase().substring(0, 10))) {
        const name = parts.slice(0, i).join(' - ').trim();
        if (name) return name;
      }
    }
    // Default: assume employee name is after the dash
    const name = parts.slice(1).join(' - ').trim();
    if (name) return name;
  }

  return null;
}
