import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import fs from 'fs/promises';
import path from 'path';

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // Dashboard stats
  fastify.get('/stats', async (request, reply) => {
    const [
      templateCount,
      packetsByStatus,
      recentActivity,
    ] = await Promise.all([
      prisma.template.count(),
      prisma.signingPacket.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          packet: { select: { name: true } },
          recipient: { select: { name: true, email: true } },
        },
      }),
    ]);

    const statusCounts: Record<string, number> = {
      draft: 0,
      sent: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    };

    for (const item of packetsByStatus) {
      statusCounts[item.status] = item._count;
    }

    return {
      templates: templateCount,
      packets: statusCounts,
      totalPackets: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      recentActivity,
    };
  });

  // Download signed PDF
  fastify.get<{ Params: { packetId: string } }>(
    '/packets/:packetId/download',
    async (request, reply) => {
      const { packetId } = request.params;

      const packet = await prisma.signingPacket.findUnique({
        where: { id: packetId },
      });

      if (!packet) {
        return reply.status(404).send({ error: 'Packet not found' });
      }

      if (packet.status !== 'completed' || !packet.signedPdfPath) {
        return reply.status(400).send({ error: 'Signed PDF not available' });
      }

      try {
        const pdfBuffer = await fs.readFile(packet.signedPdfPath);
        const fileName = `${packet.name.replace(/[^a-zA-Z0-9]/g, '_')}_signed.pdf`;

        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="${fileName}"`)
          .send(pdfBuffer);
      } catch (err) {
        return reply.status(404).send({ error: 'PDF file not found' });
      }
    }
  );

  // Audit log search
  fastify.get<{
    Querystring: {
      packetId?: string;
      action?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
  }>('/audit-logs', async (request, reply) => {
    const { packetId, action, from, to, limit = '100' } = request.query;

    const logs = await prisma.auditLog.findMany({
      where: {
        ...(packetId && { packetId }),
        ...(action && { action }),
        ...(from && { createdAt: { gte: new Date(from) } }),
        ...(to && { createdAt: { lte: new Date(to) } }),
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
      include: {
        packet: { select: { id: true, name: true } },
        recipient: { select: { name: true, email: true, roleName: true } },
      },
    });

    return logs;
  });

  // Recipient details with signature info
  fastify.get<{ Params: { recipientId: string } }>(
    '/recipients/:recipientId',
    async (request, reply) => {
      const { recipientId } = request.params;

      const recipient = await prisma.recipient.findUnique({
        where: { id: recipientId },
        include: {
          packet: {
            select: { id: true, name: true, status: true },
          },
          signature: {
            select: {
              id: true,
              signatureType: true,
              typedName: true,
              ipAddress: true,
              userAgent: true,
              createdAt: true,
            },
          },
          auditLogs: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!recipient) {
        return reply.status(404).send({ error: 'Recipient not found' });
      }

      return recipient;
    }
  );

  // System health check
  fastify.get('/health', async (request, reply) => {
    const dbCheck = await prisma.$queryRaw`SELECT 1 as ok`;

    const uploadsDir = path.join(process.cwd(), 'uploads');
    const signedDir = path.join(process.cwd(), 'signed');

    let uploadsWritable = false;
    let signedWritable = false;

    try {
      await fs.access(uploadsDir, fs.constants.W_OK);
      uploadsWritable = true;
    } catch {}

    try {
      await fs.access(signedDir, fs.constants.W_OK);
      signedWritable = true;
    } catch {}

    return {
      status: 'ok',
      database: !!dbCheck,
      storage: {
        uploads: uploadsWritable,
        signed: signedWritable,
      },
      timestamp: new Date().toISOString(),
    };
  });
};
