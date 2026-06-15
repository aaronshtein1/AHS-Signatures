import { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { config } from '../utils/config.js';
import * as gdrive from '../services/google-drive.service.js';

export const googleDriveRoutes: FastifyPluginAsync = async (fastify) => {
  // Status endpoint - no auth required (used for connection check)
  fastify.get('/status', async () => {
    if (!gdrive.isGoogleDriveConfigured()) {
      return { connected: false, configured: false };
    }
    const connected = await gdrive.isConnected();
    return { connected, configured: true };
  });

  // OAuth callback - no auth required (Google redirects here)
  fastify.get('/callback', async (request, reply) => {
    const { code, error: oauthError } = request.query as Record<string, string>;

    if (oauthError) {
      return reply.redirect(`${config.FRONTEND_URL}/form-routes?error=google_denied`);
    }

    if (!code) {
      return reply.redirect(`${config.FRONTEND_URL}/form-routes?error=no_code`);
    }

    try {
      await gdrive.handleCallback(code);
      return reply.redirect(`${config.FRONTEND_URL}/form-routes?google=connected`);
    } catch (err) {
      console.error('[Google Drive] OAuth callback error:', err);
      return reply.redirect(`${config.FRONTEND_URL}/form-routes?error=google_auth_failed`);
    }
  });

  // Admin-only routes below (scoped via register)
  fastify.register(async (admin) => {
    admin.addHook('preHandler', requireAdmin);

    // Get OAuth authorization URL
    admin.get('/auth-url', async (request, reply) => {
      if (!gdrive.isGoogleDriveConfigured()) {
        return reply.status(400).send({
          error: 'Google Drive not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env',
        });
      }
      return { url: gdrive.getAuthUrl() };
    });
  });
};
