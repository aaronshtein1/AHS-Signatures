import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { rateLimiter } from 'hono-rate-limiter';
import { config } from './utils/config.js';
import { authRoutes } from './routes/auth.js';
import { packetRoutes } from './routes/packets.js';
import { signingRoutes } from './routes/signing.js';
import { adminRoutes } from './routes/admin.js';
import { userRoutes } from './routes/user.js';
import { webhookRoutes } from './routes/webhook.js';
import { formRouteRoutes } from './routes/form-routes.js';
import { googleDriveRoutes } from './routes/google-drive.js';

if (process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_SECRET || config.JWT_SECRET === 'change-this-secret-in-production')) {
  // Login tokens signed with the public default secret can be forged by anyone
  console.error('SECURITY: JWT_SECRET is not set - set it to a long random value in production.');
}

const app = new Hono();

// Extract client IP from various proxy headers
function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return c.req.header('x-real-ip') || c.req.header('cf-connecting-ip') || 'unknown';
}

// CORS — allow the configured origin plus any Vercel preview/alias URLs for the same project
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return config.CORS_ORIGIN;
    if (origin === config.CORS_ORIGIN) return origin;
    if (origin === 'https://ahs-signing.vercel.app') return origin;
    if (origin.endsWith('.vercel.app') && origin.includes('frontend')) return origin;
    return config.CORS_ORIGIN;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Global rate limit: 200 req/min per IP
app.use('*', rateLimiter({
  windowMs: 60_000,
  limit: 200,
  keyGenerator: (c) => getClientIp(c),
}));

// Stricter rate limit on login POST only (not OAuth redirects)
app.use('/api/auth/login', rateLimiter({
  windowMs: 60_000,
  limit: 10,
  keyGenerator: (c) => getClientIp(c),
}));

app.use('/api/signing/*', rateLimiter({
  windowMs: 60_000,
  limit: 30,
  keyGenerator: (c) => getClientIp(c),
}));

app.use('/api/webhooks/*', rateLimiter({
  windowMs: 60_000,
  limit: 20,
  keyGenerator: (c) => getClientIp(c),
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes — more-specific sub-routes must be registered before the catch-all /api/admin
app.route('/api/auth', authRoutes);
app.route('/api/packets', packetRoutes);
app.route('/api/signing', signingRoutes);
app.route('/api/user', userRoutes);
app.route('/api/webhooks', webhookRoutes);
app.route('/api/admin/form-routes', formRouteRoutes);
app.route('/api/admin/google', googleDriveRoutes);
app.route('/api/admin', adminRoutes);

// Start server
serve({
  fetch: app.fetch,
  port: config.PORT,
}, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});

export default app;
