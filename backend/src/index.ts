import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { config } from './utils/config.js';
import { templateRoutes } from './routes/templates.js';
import { packetRoutes } from './routes/packets.js';
import { signingRoutes } from './routes/signing.js';
import { adminRoutes } from './routes/admin.js';

const fastify = Fastify({
  logger: true,
});

async function main() {
  // Register plugins
  await fastify.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
  });

  await fastify.register(multipart, {
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
  await fastify.register(templateRoutes, { prefix: '/api/templates' });
  await fastify.register(packetRoutes, { prefix: '/api/packets' });
  await fastify.register(signingRoutes, { prefix: '/api/signing' });
  await fastify.register(adminRoutes, { prefix: '/api/admin' });

  // Create upload directories if they don't exist
  const fs = await import('fs');
  const dirs = ['uploads/templates', 'uploads/signatures', 'signed'];
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
