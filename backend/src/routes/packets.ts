import { Hono } from 'hono';
import { db, signingPackets, recipients, auditLogs, eq, and, like, inArray } from '../db/index.js';
import { generateSecureToken, getTokenExpiryDate, generateSigningUrl } from '../utils/token.js';
import { sendSigningRequest, sendReminderEmail } from '../services/email.service.js';
import { parseTemplatePlaceholdersFromBuffer, getUniqueRoles, Placeholder } from '../services/pdf.service.js';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { uploadFile, deleteFile } from '../utils/storage.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const recipientSchema = z.object({
  roleName: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  order: z.number().int().min(1),
});

const updatePacketSchema = z.object({
  name: z.string().min(1).optional(),
  recipients: z.array(recipientSchema).optional(),
});

export const packetRoutes = new Hono();

packetRoutes.use('*', requireAdmin);

// Bulk assign
packetRoutes.post('/bulk-assign', async (c) => {
  const bulkSchema = z.object({
    packetIds: z.array(z.string()).min(1),
    signerName: z.string().min(1),
    signerEmail: z.string().email(),
    signerRole: z.string().min(1).optional(),
  });

  const validation = bulkSchema.safeParse(await c.req.json());
  if (!validation.success) {
    return c.json({ error: 'Validation failed', details: validation.error.errors }, 400);
  }

  const { packetIds, signerName, signerEmail, signerRole = 'countersigner' } = validation.data;

  const packetsToAssign = await db.query.signingPackets.findMany({
    where: and(inArray(signingPackets.id, packetIds), eq(signingPackets.status, 'pending_assignment')),
  });

  if (packetsToAssign.length === 0) {
    return c.json({ error: 'No packets found in pending_assignment status' }, 400);
  }

  let assigned = 0;
  const errors: string[] = [];

  for (const packet of packetsToAssign) {
    try {
      const token = generateSecureToken();
      const tokenExpiresAt = getTokenExpiryDate();

      const [recipient] = await db.insert(recipients).values({
        packetId: packet.id, roleName: signerRole, name: signerName,
        email: signerEmail, order: 1, token, tokenExpiresAt, status: 'notified',
      }).returning();

      await db.update(signingPackets).set({ status: 'sent' }).where(eq(signingPackets.id, packet.id));

      const signingUrl = generateSigningUrl(token);
      await sendSigningRequest(signerEmail, signerName, packet.name, signingUrl, tokenExpiresAt);

      const admin = c.get('currentUser');
      await db.insert(auditLogs).values({
        packetId: packet.id, recipientId: recipient.id, action: 'assigned',
        details: `Assigned to ${signerName} (${signerEmail}) by ${admin.name} (${admin.email})`,
      });

      assigned++;
    } catch (err) {
      errors.push(`Packet ${packet.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return c.json({ success: true, assigned, total: packetIds.length, errors });
});

// List all packets
packetRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  const county = c.req.query('county');
  const formRouteId = c.req.query('formRouteId');

  const conditions = [];
  if (status) conditions.push(eq(signingPackets.status, status));
  if (county) conditions.push(like(signingPackets.county, `%${county}%`));
  if (formRouteId) conditions.push(eq(signingPackets.formRouteId, formRouteId));

  const packets = await db.query.signingPackets.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: {
      recipients: {
        orderBy: (r, { asc }) => [asc(r.order)],
        columns: { id: true, roleName: true, name: true, email: true, order: true, status: true, signedAt: true },
      },
      auditLogs: { columns: { id: true } },
    },
  });

  return c.json(packets.map(p => {
    const { auditLogs: logs, ...rest } = p;
    return {
      ...rest,
      _count: { auditLogs: logs.length },
      placeholders: JSON.parse(rest.placeholders as string),
    };
  }));
});

// Get single packet
packetRoutes.get('/:id', async (c) => {
  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, c.req.param('id')),
    with: {
      recipients: {
        orderBy: (r, { asc }) => [asc(r.order)],
        with: {
          signature: {
            columns: { id: true, signatureType: true, typedName: true, createdAt: true },
          },
        },
      },
      auditLogs: {
        orderBy: (a, { desc }) => [desc(a.createdAt)],
      },
    },
  });

  if (!packet) return c.json({ error: 'Packet not found' }, 404);

  return c.json({ ...packet, placeholders: JSON.parse(packet.placeholders as string) });
});

// Create new packet with PDF upload
packetRoutes.post('/', async (c) => {
  const body = await c.req.parseBody({ all: true });

  const fileField = body.file as File | undefined;
  if (!fileField || !(fileField instanceof File)) {
    return c.json({ error: 'No file uploaded' }, 400);
  }

  if (fileField.type !== 'application/pdf') {
    return c.json({ error: 'Only PDF files are allowed' }, 400);
  }

  const name = (body.name as string) || fileField.name.replace('.pdf', '');
  const recipientsJson = body.recipients as string;

  if (!recipientsJson) {
    return c.json({ error: 'Recipients are required' }, 400);
  }

  let recipientList: z.infer<typeof recipientSchema>[];
  try {
    recipientList = JSON.parse(recipientsJson);
    const validation = z.array(recipientSchema).min(1).safeParse(recipientList);
    if (!validation.success) {
      return c.json({ error: 'Invalid recipients', details: validation.error.errors }, 400);
    }
  } catch {
    return c.json({ error: 'Invalid recipients JSON' }, 400);
  }

  const packetId = uuidv4();
  const fileId = uuidv4();
  const fileName = `${fileId}_${fileField.name}`;
  const storageKey = `packets/${packetId}/${fileName}`;

  const buffer = Buffer.from(await fileField.arrayBuffer());
  await uploadFile(storageKey, buffer);

  let placeholders: Placeholder[] = [];
  try {
    placeholders = await parseTemplatePlaceholdersFromBuffer(buffer);
  } catch (err) {
    console.error('Failed to parse placeholders:', err);
  }

  const packet = await db.transaction(async (tx) => {
    const [pkt] = await tx.insert(signingPackets).values({
      id: packetId,
      name,
      fileName: fileField.name,
      filePath: storageKey,
      placeholders: JSON.stringify(placeholders),
      status: 'draft',
    }).returning();

    const recs = await tx.insert(recipients).values(
      recipientList.map(r => ({
        ...r,
        packetId,
        token: generateSecureToken(),
        tokenExpiresAt: getTokenExpiryDate(),
      }))
    ).returning();

    return { ...pkt, recipients: recs.sort((a, b) => a.order - b.order) };
  });

  const admin = c.get('currentUser');
  await db.insert(auditLogs).values({
    packetId: packet.id, action: 'created',
    details: `Packet "${name}" created with ${recipientList.length} recipients by ${admin.name} (${admin.email})`,
  });

  const roles = getUniqueRoles(placeholders);

  return c.json({ ...packet, placeholders, roles });
});

// Update packet (only drafts)
packetRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const validation = updatePacketSchema.safeParse(await c.req.json());
  if (!validation.success) {
    return c.json({ error: 'Validation failed', details: validation.error.errors }, 400);
  }

  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, id),
    with: { recipients: true },
  });
  if (!packet) return c.json({ error: 'Packet not found' }, 404);
  if (packet.status !== 'draft') return c.json({ error: 'Can only update draft packets' }, 400);

  const { name, recipients: recipientList } = validation.data;

  if (recipientList) {
    await db.delete(recipients).where(eq(recipients.packetId, id));
  }

  if (name) {
    await db.update(signingPackets).set({ name }).where(eq(signingPackets.id, id));
  }

  if (recipientList) {
    await db.insert(recipients).values(
      recipientList.map(r => ({
        ...r,
        packetId: id,
        token: generateSecureToken(),
        tokenExpiresAt: getTokenExpiryDate(),
      }))
    );
  }

  const admin = c.get('currentUser');
  const changes: string[] = [];
  if (name) changes.push(`name to "${name}"`);
  if (recipientList) changes.push(`recipients (${recipientList.length})`);
  await db.insert(auditLogs).values({
    packetId: id, action: 'updated',
    details: `Packet updated: ${changes.join(', ')} by ${admin.name} (${admin.email})`,
  });

  const updated = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, id),
    with: {
      recipients: {
        orderBy: (r, { asc }) => [asc(r.order)],
      },
    },
  });

  return c.json({ ...updated!, placeholders: JSON.parse(updated!.placeholders as string) });
});

// Send packet
packetRoutes.post('/:id/send', async (c) => {
  const id = c.req.param('id');

  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, id),
    with: {
      recipients: {
        orderBy: (r, { asc }) => [asc(r.order)],
      },
    },
  });

  if (!packet) return c.json({ error: 'Packet not found' }, 404);
  if (packet.status !== 'draft') return c.json({ error: 'Packet has already been sent' }, 400);
  if (packet.recipients.length === 0) return c.json({ error: 'Packet has no recipients' }, 400);

  const firstRecipient = packet.recipients.find(r => r.order === 1);
  if (!firstRecipient) return c.json({ error: 'No recipient with order 1' }, 400);

  const token = generateSecureToken();
  const tokenExpiresAt = getTokenExpiryDate();

  await db.update(recipients)
    .set({ token, tokenExpiresAt, status: 'notified' })
    .where(eq(recipients.id, firstRecipient.id));

  const signingUrl = generateSigningUrl(token);
  await sendSigningRequest(firstRecipient.email, firstRecipient.name, packet.name, signingUrl, tokenExpiresAt);

  await db.update(signingPackets).set({ status: 'sent' }).where(eq(signingPackets.id, id));

  const admin = c.get('currentUser');
  await db.insert(auditLogs).values({
    packetId: id, recipientId: firstRecipient.id, action: 'sent',
    details: `Signing request sent to ${firstRecipient.email} by ${admin.name} (${admin.email})`,
  });

  return c.json({ success: true, message: 'Signing request sent' });
});

// Resend link
packetRoutes.post('/:id/resend', async (c) => {
  const id = c.req.param('id');

  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, id),
    with: {
      recipients: {
        orderBy: (r, { asc }) => [asc(r.order)],
      },
    },
  });

  if (!packet) return c.json({ error: 'Packet not found' }, 404);
  if (packet.status === 'completed' || packet.status === 'cancelled') {
    return c.json({ error: 'Packet is no longer active' }, 400);
  }

  const currentRecipient = packet.recipients.find(r => r.status === 'notified' || r.status === 'pending');
  if (!currentRecipient) return c.json({ error: 'No pending recipient found' }, 400);

  const token = generateSecureToken();
  const tokenExpiresAt = getTokenExpiryDate();

  await db.update(recipients)
    .set({ token, tokenExpiresAt, status: 'notified' })
    .where(eq(recipients.id, currentRecipient.id));

  const signingUrl = generateSigningUrl(token);
  await sendReminderEmail(currentRecipient.email, currentRecipient.name, packet.name, signingUrl, tokenExpiresAt);

  const admin = c.get('currentUser');
  await db.insert(auditLogs).values({
    packetId: id, recipientId: currentRecipient.id, action: 'resent',
    details: `New signing link sent to ${currentRecipient.email} by ${admin.name} (${admin.email})`,
  });

  return c.json({ success: true, message: 'New signing link sent' });
});

// Cancel packet
packetRoutes.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, id),
  });

  if (!packet) return c.json({ error: 'Packet not found' }, 404);
  if (packet.status === 'completed') return c.json({ error: 'Cannot cancel completed packet' }, 400);

  const admin = c.get('currentUser');
  await db.update(signingPackets).set({ status: 'cancelled' }).where(eq(signingPackets.id, id));
  await db.insert(auditLogs).values({
    packetId: id, action: 'cancelled',
    details: `Packet cancelled by ${admin.name} (${admin.email})`,
  });

  return c.json({ success: true });
});

// Delete draft packet
packetRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, id),
  });

  if (!packet) return c.json({ error: 'Packet not found' }, 404);
  if (packet.status !== 'draft') return c.json({ error: 'Can only delete draft packets' }, 400);

  const admin = c.get('currentUser');
  console.log(`[Audit] Draft packet "${packet.name}" (${id}) deleted by ${admin.name} (${admin.email})`);

  try {
    await deleteFile(packet.filePath);
  } catch (err) {
    console.error('Failed to delete packet file:', err);
  }

  await db.delete(signingPackets).where(eq(signingPackets.id, id));
  return c.json({ success: true });
});

// Reassign recipient
packetRoutes.post('/:id/recipients/:recipientId/reassign', async (c) => {
  const id = c.req.param('id');
  const recipientId = c.req.param('recipientId');
  const { name, email } = await c.req.json() as { name: string; email: string };

  if (!name || !email) return c.json({ error: 'Name and email are required' }, 400);

  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, id),
    with: {
      recipients: {
        orderBy: (r, { asc }) => [asc(r.order)],
      },
    },
  });

  if (!packet) return c.json({ error: 'Packet not found' }, 404);
  if (packet.status === 'completed' || packet.status === 'cancelled') {
    return c.json({ error: 'Packet is no longer active' }, 400);
  }

  const recipient = packet.recipients.find(r => r.id === recipientId);
  if (!recipient) return c.json({ error: 'Recipient not found' }, 404);
  if (recipient.status === 'signed') return c.json({ error: 'Cannot reassign a recipient who has already signed' }, 400);

  const oldName = recipient.name;
  const oldEmail = recipient.email;

  const token = generateSecureToken();
  const tokenExpiresAt = getTokenExpiryDate();

  await db.update(recipients)
    .set({ name, email, token, tokenExpiresAt, status: 'notified' })
    .where(eq(recipients.id, recipientId));

  const signingUrl = generateSigningUrl(token);
  await sendSigningRequest(email, name, packet.name, signingUrl, tokenExpiresAt);

  const admin = c.get('currentUser');
  await db.insert(auditLogs).values({
    packetId: id, recipientId, action: 'reassigned',
    details: `Reassigned from ${oldName} (${oldEmail}) to ${name} (${email}) by ${admin.name} (${admin.email})`,
  });

  return c.json({ success: true, message: `Reassigned to ${name} and sent signing request` });
});

// Get packet timeline
packetRoutes.get('/:id/timeline', async (c) => {
  const logs = await db.query.auditLogs.findMany({
    where: eq(auditLogs.packetId, c.req.param('id')),
    orderBy: (a, { desc }) => [desc(a.createdAt)],
    with: {
      recipient: {
        columns: { name: true, email: true, roleName: true },
      },
    },
  });
  return c.json(logs);
});

// Get packet roles
packetRoutes.get('/:id/roles', async (c) => {
  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, c.req.param('id')),
  });
  if (!packet) return c.json({ error: 'Packet not found' }, 404);

  const placeholders = JSON.parse(packet.placeholders as string);
  const roles = getUniqueRoles(placeholders);
  return c.json({ roles, placeholders });
});
