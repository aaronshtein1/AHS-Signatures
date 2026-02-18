import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  // Protect all user routes
  fastify.addHook('preHandler', requireAuth);

  // GET /documents - user's assigned documents (matched by email)
  fastify.get('/documents', async (request) => {
    const currentUser = request.currentUser!;

    // Find recipients that match the user's email
    const recipients = await prisma.recipient.findMany({
      where: { email: currentUser.email },
      include: {
        packet: {
          select: {
            id: true,
            name: true,
            fileName: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: { packet: { createdAt: 'desc' } },
    });

    return recipients.map((r) => ({
      id: r.id,
      roleName: r.roleName,
      status: r.status,
      signedAt: r.signedAt,
      packet: r.packet,
      canSign: r.status === 'notified' || r.status === 'pending',
    }));
  });

  // GET /documents/:id/sign-url - get signing URL for a document
  fastify.get<{ Params: { id: string } }>(
    '/documents/:id/sign-url',
    async (request, reply) => {
      const currentUser = request.currentUser!;
      const { id } = request.params;

      const recipient = await prisma.recipient.findFirst({
        where: {
          id,
          email: currentUser.email,
        },
      });

      if (!recipient) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      if (recipient.status === 'signed') {
        return reply.status(400).send({ error: 'Already signed' });
      }

      return { signUrl: `/sign/${recipient.token}` };
    }
  );
};
