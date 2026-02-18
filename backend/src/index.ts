import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { config } from './utils/config.js';
import { authRoutes } from './routes/auth.js';
import { packetRoutes } from './routes/packets.js';
import { signingRoutes } from './routes/signing.js';
import { adminRoutes } from './routes/admin.js';
import { userRoutes } from './routes/user.js';

const fastify = Fastify({
  logger: true,
});

async function main() {
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

  // Register routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(userRoutes, { prefix: '/api/user' });
  await fastify.register(packetRoutes, { prefix: '/api/packets' });
  await fastify.register(signingRoutes, { prefix: '/api/signing' });
  await fastify.register(adminRoutes, { prefix: '/api/admin' });

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
