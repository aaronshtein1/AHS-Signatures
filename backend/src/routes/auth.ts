import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { config } from '../utils/config.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/login - Login with email and password
  fastify.post('/login', async (request, reply) => {
    try {
      const body = loginSchema.parse(request.body);

      const user = await authService.findUserByEmail(body.email);
      if (!user) {
        return reply.status(401).send({ error: 'Invalid email or password' });
      }

      if (!user.isActive) {
        return reply.status(403).send({ error: 'Account is disabled' });
      }

      const validPassword = await authService.verifyPassword(
        body.password,
        user.passwordHash
      );
      if (!validPassword) {
        return reply.status(401).send({ error: 'Invalid email or password' });
      }

      await authService.updateLastLogin(user.id);

      const token = fastify.jwt.sign(
        { userId: user.id },
        { expiresIn: config.JWT_EXPIRES_IN }
      );

      // Set JWT as HTTP-only cookie
      reply.setCookie('token', token, {
        httpOnly: true,
        secure: true, // Required for sameSite: 'none'
        sameSite: 'none', // Required for cross-origin cookies
        path: '/',
        maxAge: 60 * 60 * 24, // 24 hours
      });

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: err.errors });
      }
      throw err;
    }
  });

  // POST /api/auth/logout - Clear the auth cookie
  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('token', {
      path: '/',
      secure: true,
      sameSite: 'none',
    });
    return reply.send({ success: true });
  });

  // GET /api/auth/me - Get current user info
  fastify.get('/me', { preHandler: [requireAuth] }, async (request, reply) => {
    return reply.send({ user: request.currentUser });
  });
}
