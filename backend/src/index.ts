import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import path from 'path';
import { config } from './utils/config.js';
import { authRoutes } from './routes/auth.js';
import { packetRoutes } from './routes/packets.js';
import { signingRoutes } from './routes/signing.js';
import { adminRoutes } from './routes/admin.js';
import { userRoutes } from './routes/user.js';
import { webhookRoutes } from './routes/webhook.js';
import { formRouteRoutes } from './routes/form-routes.js';
import { googleDriveRoutes } from './routes/google-drive.js';

const fastify = Fastify({
  logger: true,
});

async function main() {
  // --- Production safety checks ---
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-this-secret-in-production') {
      console.error('FATAL: JWT_SECRET must be set to a secure value in production');
      process.exit(1);
    }
  }

  // CORS: Add headers to ALL responses including errors
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', config.CORS_ORIGIN);
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    reply.header('Access-Control-Allow-Credentials', 'true');
  });

  // Register cors plugin for preflight handling
  await fastify.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Rate limiting — global default, stricter on public endpoints
  await fastify.register(rateLimit, {
    max: 100,         // 100 requests per minute for authenticated routes
    timeWindow: '1 minute',
  });

  // Cookie support (must be registered before JWT)
  await fastify.register(fastifyCookie);

  // JWT authentication with cookie support
  await fastify.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    cookie: {
      cookieName: 'token',
      signed: false,
    },
  });

  await fastify.register(multipart, {
    attachFieldsToBody: true,
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max
    },
  });

  // Serve uploaded files
  await fastify.register(fastifyStatic, {
    root: path.join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Serve signed PDFs
  await fastify.register(fastifyStatic, {
    root: path.join(process.cwd(), 'signed'),
    prefix: '/signed/',
    decorateReply: false,
  });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register routes — apply stricter rate limits to public-facing endpoints
  await fastify.register(async function authPlugin(app) {
    app.register(rateLimit, { max: 10, timeWindow: '1 minute' }); // Brute-force protection
    app.register(authRoutes);
  }, { prefix: '/api/auth' });
  await fastify.register(userRoutes, { prefix: '/api/user' });
  await fastify.register(packetRoutes, { prefix: '/api/packets' });
  await fastify.register(async function signingPlugin(app) {
    app.register(rateLimit, { max: 30, timeWindow: '1 minute' }); // Public signing
    app.register(signingRoutes);
  }, { prefix: '/api/signing' });
  await fastify.register(adminRoutes, { prefix: '/api/admin' });
  await fastify.register(async function webhookPlugin(app) {
    app.register(rateLimit, { max: 20, timeWindow: '1 minute' }); // Webhook protection
    app.register(webhookRoutes);
  }, { prefix: '/api/webhooks' });
  await fastify.register(formRouteRoutes, { prefix: '/api/admin/form-routes' });
  await fastify.register(googleDriveRoutes, { prefix: '/api/admin/google' });

  // Create upload directories if they don't exist
  const fs = await import('fs');
  const dirs = ['uploads/packets', 'signed'];
  for (const dir of dirs) {
    const fullPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // Start server
  try {
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`Server running on http://localhost:${config.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
