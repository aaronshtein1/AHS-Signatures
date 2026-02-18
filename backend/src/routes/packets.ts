import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { generateSecureToken, getTokenExpiryDate, generateSigningUrl } from '../utils/token.js';
import { sendSigningRequest, sendReminderEmail } from '../services/email.service.js';
import { parseTemplatePlaceholders, getUniqueRoles, Placeholder } from '../services/pdf.service.js';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
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

export const packetRoutes: FastifyPluginAsync = async (fastify) => {
  // Protect all packet routes - admin only
  fastify.addHook('preHandler', requireAdmin);

  // List all packets
  fastify.get<{
    Querystring: { status?: string };
  }>('/', async (request, reply) => {
    const { status } = request.query;

    const packets = await prisma.signingPacket.findMany({
      where: {
        ...(status && { status }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        recipients: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            roleName: true,
            name: true,
            email: true,
            order: true,
            status: true,
            signedAt: true,
          },
        },
        _count: {
          select: { auditLogs: true },
        },
      },
    });

    return packets.map(p => ({
      ...p,
      placeholders: JSON.parse(p.placeholders as string),
    }));
  });

  // Get single packet
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const packet = await prisma.signingPacket.findUnique({
      where: { id },
      include: {
        recipients: {
          orderBy: { order: 'asc' },
          include: {
            signature: {
              select: {
                id: true,
                signatureType: true,
                typedName: true,
                createdAt: true,
              },
            },
          },
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!packet) {
      return reply.status(404).send({ error: 'Packet not found' });
    }

    return {
      ...packet,
      placeholders: JSON.parse(packet.placeholders as string),
    };
  });

  // Create new packet with PDF upload
  fastify.post('/', async (request, reply) => {
    // With attachFieldsToBody: true, all fields are in request.body
    const body = request.body as Record<string, any>;

    // Get the file field
    const fileField = body?.file;
    if (!fileField || !fileField.toBuffer) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    if (fileField.mimetype !== 'application/pdf') {
      return reply.status(400).send({ error: 'Only PDF files are allowed' });
    }

    // Get form fields (they come as { value: string } objects)
    const name = body?.name?.value || fileField.filename.replace('.pdf', '');
    const recipientsJson = body?.recipients?.value;

    if (!recipientsJson) {
      return reply.status(400).send({ error: 'Recipients are required' });
    }

    // Parse and validate recipients
    let recipients: z.infer<typeof recipientSchema>[];
    try {
      recipients = JSON.parse(recipientsJson);
      const validation = z.array(recipientSchema).min(1).safeParse(recipients);
      if (!validation.success) {
        return reply.status(400).send({
          error: 'Invalid recipients',
          details: validation.error.errors,
        });
      }
    } catch (err) {
      return reply.status(400).send({ error: 'Invalid recipients JSON' });
    }

    // Generate unique IDs
    const packetId = uuidv4();
    const fileId = uuidv4();
    const fileName = `${fileId}_${fileField.filename}`;
    const packetDir = path.join(process.cwd(), 'uploads', 'packets', packetId);
    const filePath = path.join(packetDir, fileName);

    // Ensure directory exists and save file
    await fs.mkdir(packetDir, { recursive: true });
    const buffer = await fileField.toBuffer();
    await fs.writeFile(filePath, buffer);

    // Parse placeholders from PDF
    let placeholders: Placeholder[] = [];
    try {
      placeholders = await parseTemplatePlaceholders(filePath);
    } catch (err) {
      console.error('Failed to parse placeholders:', err);
    }

    // Create packet with embedded PDF info
    const packet = await prisma.signingPacket.create({
      data: {
        id: packetId,
        name,
        fileName: fileField.filename,
        filePath: `packets/${packetId}/${fileName}`,
        placeholders: JSON.stringify(placeholders),
        status: 'draft',
        recipients: {
          create: recipients.map(r => ({
            ...r,
            token: generateSecureToken(),
            tokenExpiresAt: getTokenExpiryDate(),
          })),
        },
      },
      include: {
        recipients: {
          orderBy: { order: 'asc' },
        },
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        packetId: packet.id,
        action: 'created',
        details: `Packet "${name}" created with ${recipients.length} recipients`,
      },
    });

    const roles = getUniqueRoles(placeholders);

    return {
      ...packet,
      placeholders,
      roles,
    };
  });

  // Update packet (only in draft status)
  fastify.patch<{
    Params: { id: string };
    Body: z.infer<typeof updatePacketSchema>;
  }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const validation = updatePacketSchema.safeParse(request.body);

    if (!validation.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const packet = await prisma.signingPacket.findUnique({
      where: { id },
      include: { recipients: true },
    });

    if (!packet) {
      return reply.status(404).send({ error: 'Packet not found' });
    }

    if (packet.status !== 'draft') {
      return reply.status(400).send({ error: 'Can only update draft packets' });
    }

    const { name, recipients } = validation.data;

    // Update packet
    if (recipients) {
      // Delete existing recipients and create new ones
      await prisma.recipient.deleteMany({ where: { packetId: id } });
    }

    const updated = await prisma.signingPacket.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(recipients && {
          recipients: {
            create: recipients.map(r => ({
              ...r,
              token: generateSecureToken(),
              tokenExpiresAt: getTokenExpiryDate(),
            })),
          },
        }),
      },
      include: {
        recipients: {
          orderBy: { order: 'asc' },
        },
      },
    });

    return {
      ...updated,
      placeholders: JSON.parse(updated.placeholders as string),
    };
  });

  // Send packet (trigger signing workflow)
  fastify.post<{ Params: { id: string } }>('/:id/send', async (request, reply) => {
    const { id } = request.params;

    const packet = await prisma.signingPacket.findUnique({
      where: { id },
      include: {
        recipients: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!packet) {
      return reply.status(404).send({ error: 'Packet not found' });
    }

    if (packet.status !== 'draft') {
      return reply.status(400).send({ error: 'Packet has already been sent' });
    }

    if (packet.recipients.length === 0) {
      return reply.status(400).send({ error: 'Packet has no recipients' });
    }

    // Find first recipient (order = 1)
    const firstRecipient = packet.recipients.find(r => r.order === 1);
    if (!firstRecipient) {
      return reply.status(400).send({ error: 'No recipient with order 1' });
    }

    // Generate fresh token for first recipient
    const token = generateSecureToken();
    const tokenExpiresAt = getTokenExpiryDate();

    await prisma.recipient.update({
      where: { id: firstRecipient.id },
      data: {
        token,
        tokenExpiresAt,
        status: 'notified',
      },
    });

    // Send email to first signer
    const signingUrl = generateSigningUrl(token);
    await sendSigningRequest(
      firstRecipient.email,
      firstRecipient.name,
      packet.name,
      signingUrl,
      tokenExpiresAt
    );

    // Update packet status
    await prisma.signingPacket.update({
      where: { id },
      data: { status: 'sent' },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        packetId: id,
        recipientId: firstRecipient.id,
        action: 'sent',
        details: `Signing request sent to ${firstRecipient.email}`,
      },
    });

    return { success: true, message: 'Signing request sent' };
  });

  // Resend link to current signer
  fastify.post<{ Params: { id: string } }>('/:id/resend', async (request, reply) => {
    const { id } = request.params;

    const packet = await prisma.signingPacket.findUnique({
      where: { id },
      include: {
        recipients: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!packet) {
      return reply.status(404).send({ error: 'Packet not found' });
    }

    if (packet.status === 'completed' || packet.status === 'cancelled') {
      return reply.status(400).send({ error: 'Packet is no longer active' });
    }

    // Find current pending/notified recipient
    const currentRecipient = packet.recipients.find(
      r => r.status === 'notified' || r.status === 'pending'
    );

    if (!currentRecipient) {
      return reply.status(400).send({ error: 'No pending recipient found' });
    }

    // Generate new token (invalidates old one)
    const token = generateSecureToken();
    const tokenExpiresAt = getTokenExpiryDate();

    await prisma.recipient.update({
      where: { id: currentRecipient.id },
      data: {
        token,
        tokenExpiresAt,
        status: 'notified',
      },
    });

    // Send email
    const signingUrl = generateSigningUrl(token);
    await sendReminderEmail(
      currentRecipient.email,
      currentRecipient.name,
      packet.name,
      signingUrl,
      tokenExpiresAt
    );

    // Audit log
    await prisma.auditLog.create({
      data: {
        packetId: id,
        recipientId: currentRecipient.id,
        action: 'resent',
        details: `New signing link sent to ${currentRecipient.email}`,
      },
    });

    return { success: true, message: 'New signing link sent' };
  });

  // Cancel packet
  fastify.post<{ Params: { id: string } }>('/:id/cancel', async (request, reply) => {
    const { id } = request.params;

    const packet = await prisma.signingPacket.findUnique({ where: { id } });

    if (!packet) {
      return reply.status(404).send({ error: 'Packet not found' });
    }

    if (packet.status === 'completed') {
      return reply.status(400).send({ error: 'Cannot cancel completed packet' });
    }

    await prisma.signingPacket.update({
      where: { id },
      data: { status: 'cancelled' },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        packetId: id,
        action: 'cancelled',
        details: 'Packet cancelled by admin',
      },
    });

    return { success: true };
  });

  // Delete packet (only drafts)
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const packet = await prisma.signingPacket.findUnique({ where: { id } });

    if (!packet) {
      return reply.status(404).send({ error: 'Packet not found' });
    }

    if (packet.status !== 'draft') {
      return reply.status(400).send({ error: 'Can only delete draft packets' });
    }

    // Delete PDF file
    try {
      const fullPath = path.join(process.cwd(), 'uploads', packet.filePath);
      await fs.unlink(fullPath);
      // Try to remove the packet directory if empty
      const packetDir = path.dirname(fullPath);
      await fs.rmdir(packetDir);
    } catch (err) {
      console.error('Failed to delete packet file:', err);
    }

    await prisma.signingPacket.delete({ where: { id } });

    return { success: true };
  });

  // Get packet timeline/audit log
  fastify.get<{ Params: { id: string } }>('/:id/timeline', async (request, reply) => {
    const { id } = request.params;

    const logs = await prisma.auditLog.findMany({
      where: { packetId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        recipient: {
          select: { name: true, email: true, roleName: true },
        },
      },
    });

    return logs;
  });

  // Get packet roles (from placeholders)
  fastify.get<{ Params: { id: string } }>('/:id/roles', async (request, reply) => {
    const { id } = request.params;

    const packet = await prisma.signingPacket.findUnique({ where: { id } });

    if (!packet) {
      return reply.status(404).send({ error: 'Packet not found' });
    }

    const placeholders = JSON.parse(packet.placeholders as string);
    const roles = getUniqueRoles(placeholders);

    return { roles, placeholders };
  });
};
