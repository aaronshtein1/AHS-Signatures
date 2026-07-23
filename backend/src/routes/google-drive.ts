import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { config } from '../utils/config.js';
import * as gdrive from '../services/google-drive.service.js';

export const googleDriveRoutes = new Hono();

// GET /status - no auth required
googleDriveRoutes.get('/status', async (c) => {
  if (!gdrive.isGoogleDriveConfigured()) {
    return c.json({ connected: false, configured: false });
  }
  const connected = await gdrive.isConnected();
  return c.json({ connected, configured: true });
});

// GET /callback - OAuth callback, no auth required
googleDriveRoutes.get('/callback', async (c) => {
  const code = c.req.query('code');
  const oauthError = c.req.query('error');

  if (oauthError) {
    return c.redirect(`${config.FRONTEND_URL}/form-routes?error=google_denied`);
  }

  if (!code) {
    return c.redirect(`${config.FRONTEND_URL}/form-routes?error=no_code`);
  }

  try {
    await gdrive.handleCallback(code);
    return c.redirect(`${config.FRONTEND_URL}/form-routes?google=connected`);
  } catch (err) {
    console.error('[Google Drive] OAuth callback error:', err);
    return c.redirect(`${config.FRONTEND_URL}/form-routes?error=google_auth_failed`);
  }
});

// GET /browse - list folders (optionally within a parent folder)
googleDriveRoutes.get('/browse', requireAdmin, async (c) => {
  const parentId = c.req.query('parentId');
  try {
    const folders = await gdrive.listFolders(parentId || undefined);
    return c.json({ folders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to browse Drive: ${msg}` }, 502);
  }
});

// GET /files - list PDFs in a folder
googleDriveRoutes.get('/files', requireAdmin, async (c) => {
  const folderId = c.req.query('folderId');
  if (!folderId) return c.json({ error: 'folderId query parameter required' }, 400);
  try {
    const files = await gdrive.listFiles(folderId);
    return c.json({ files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to list files: ${msg}` }, 502);
  }
});

// GET /auth-url - admin only
googleDriveRoutes.get('/auth-url', requireAdmin, async (c) => {
  if (!gdrive.isGoogleDriveConfigured()) {
    return c.json({
      error: 'Google Drive not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env',
    }, 400);
  }
  return c.json({ url: gdrive.getAuthUrl() });
});
