import { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      name: string;
      role: string;
      isActive: boolean;
    };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string };
    user: { userId: string };
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();

    const { userId } = request.user as { userId: string };
    const user = await authService.findUserById(userId);

    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    if (!user.isActive) {
      return reply.status(403).send({ error: 'Account is disabled' });
    }

    request.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    };
  } catch (err) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await requireAuth(request, reply);

  if (reply.sent) return;

  if (request.user?.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}
