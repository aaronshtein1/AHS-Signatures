import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { generateSecureToken, getTokenExpiryDate, generateSigningUrl } from '../utils/token.js';
import { sendSigningRequest, sendReminderEmail } from '../services/email.service.js';
import { z } from 'zod';

const createPacketSchema = z.object({
  name: z.string().min(1),
  templateId: z.string().uuid(),
  recipients: z.array(z.object({
    roleName: z.string().min(1),
    name: z.string().min(1),
    email: z.string().email(),
    order: z.number().int().min(1),
  })).min(1),
});

const updatePacketSchema = z.object({
  name: z.string().min(1).optional(),
  recipients: z.array(z.object({
    roleName: z.string().min(1),
    name: z.string().min(1),
    email: z.string().email(),
    order: z.number().int().min(1),
  })).optional(),
});

export const packetRoutes: FastifyPluginAsync = async (fastify) => {
  // List all packets
  fastify.get<{
    Querystring: { status?: string; templateId?: string };
  }>('/', async (request, reply) => {
    const { status, templateId } = request.query;

    const packets = await prisma.signingPacket.findMany({
      where: {
        ...(status && { status }),
        ...(templateId && { templateId }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        template: {
          select: { id: true, name: true },
        },
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

    return packets;
  });

  // Get single packet
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const packet = await prisma.signingPacket.findUnique({
      where: { id },
      include: {
        template: true,
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
      template: {
        ...packet.template,
        placeholders: JSON.parse(packet.template.placeholders as string),
      },
    };
  });

  // Create new packet
  fastify.post<{ Body: z.infer<typeof createPacketSchema> }>('/', async (request, reply) => {
    const validation = createPacketSchema.safeParse(request.body);

    if (!validation.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { name, templateId, recipients } = validation.data;

    // Verify template exists
    const template = await prisma.template.findUnique({ where: { id: templateId } });
    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    // Create packet with recipients
    const packet = await prisma.signingPacket.create({
      data: {
        name,
        templateId,
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
        template: {
          select: { id: true, name: true },
        },
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

    return packet;
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
        template: {
          select: { id: true, name: true },
        },
        recipients: {
          orderBy: { order: 'asc' },
        },
      },
    });

    return updated;
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
};
