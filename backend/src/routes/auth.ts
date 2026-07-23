import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { SignJWT, decodeJwt } from 'jose';
import { z } from 'zod';
import crypto from 'crypto';
import { authService } from '../services/auth.service.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { config } from '../utils/config.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SSO_DOMAIN = '@homecare4all.org';

function getMicrosoftRedirectUri(): string {
  const base = config.API_BASE_URL || `http://localhost:${config.PORT}`;
  return `${base}/api/auth/microsoft/callback`;
}

export const authRoutes = new Hono();

// Helper: return an HTML page that redirects client-side (Neon Functions proxy follows 302s)
function htmlRedirect(url: string) {
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${url}"><script>window.location.href="${url}";</script></head><body>Redirecting...</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// GET /microsoft — HTML redirect to Microsoft OAuth (for direct browser navigation)
authRoutes.get('/microsoft', (c) => {
  if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_TENANT_ID) {
    return c.text('Microsoft SSO not configured', 500);
  }

  const params = new URLSearchParams({
    client_id: config.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: getMicrosoftRedirectUri(),
    scope: 'openid email profile User.Read',
    response_mode: 'query',
  });

  const url = `https://login.microsoftonline.com/${config.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize?${params}`;
  return htmlRedirect(url);
});

// GET /microsoft/auth-url — returns the Microsoft OAuth URL (JSON, for programmatic use)
authRoutes.get('/microsoft/auth-url', (c) => {
  if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_TENANT_ID) {
    return c.json({ error: 'Microsoft SSO not configured' }, 500);
  }

  const params = new URLSearchParams({
    client_id: config.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: getMicrosoftRedirectUri(),
    scope: 'openid email profile User.Read',
    response_mode: 'query',
  });

  const url = `https://login.microsoftonline.com/${config.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize?${params}`;
  return c.json({ url });
});

// GET /microsoft/callback — handle OAuth callback
authRoutes.get('/microsoft/callback', async (c) => {
  const code = c.req.query('code');
  const oauthError = c.req.query('error');
  const errorDescription = c.req.query('error_description');

  if (oauthError) {
    console.error('[Auth] Microsoft OAuth error:', oauthError, errorDescription);
    return htmlRedirect(`${config.FRONTEND_URL}/login?error=microsoft_denied`);
  }

  if (!code) {
    return htmlRedirect(`${config.FRONTEND_URL}/login?error=no_code`);
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${config.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.MICROSOFT_CLIENT_ID,
          client_secret: config.MICROSOFT_CLIENT_SECRET,
          code,
          redirect_uri: getMicrosoftRedirectUri(),
          grant_type: 'authorization_code',
          scope: 'openid email profile User.Read',
        }),
      }
    );

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error('[Auth] Microsoft token exchange failed:', err);
      return htmlRedirect(`${config.FRONTEND_URL}/login?error=microsoft_token_failed`);
    }

    const tokens = await tokenResponse.json() as { access_token?: string; id_token?: string };
    console.log('[Auth] Token exchange succeeded, has id_token:', !!tokens.id_token, 'has access_token:', !!tokens.access_token);

    let email = '';
    let name = '';

    // Try id_token first, fall back to Microsoft Graph /me
    if (tokens.id_token) {
      try {
        const claims = decodeJwt(tokens.id_token);
        email = ((claims.email || claims.preferred_username) as string || '').toLowerCase();
        name = (claims.name as string) || '';
        console.log('[Auth] id_token claims - email:', email, 'name:', name);
      } catch (decodeErr) {
        console.error('[Auth] Failed to decode id_token:', decodeErr);
      }
    }

    // Fallback: use access_token to call Microsoft Graph /me
    if (!email && tokens.access_token) {
      console.log('[Auth] Falling back to Microsoft Graph /me');
      const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (graphResponse.ok) {
        const profile = await graphResponse.json() as { mail?: string; userPrincipalName?: string; displayName?: string };
        email = (profile.mail || profile.userPrincipalName || '').toLowerCase();
        name = profile.displayName || '';
        console.log('[Auth] Graph /me - email:', email, 'name:', name);
      } else {
        console.error('[Auth] Graph /me failed:', await graphResponse.text());
      }
    }

    if (!name) {
      name = email.split('@')[0];
    }

    if (!email) {
      return htmlRedirect(`${config.FRONTEND_URL}/login?error=no_email`);
    }

    if (!email.endsWith(SSO_DOMAIN)) {
      return htmlRedirect(`${config.FRONTEND_URL}/login?error=invalid_domain`);
    }

    // Find or create user
    let user = await authService.findUserByEmail(email);

    if (!user) {
      // Auto-create with random password (SSO users won't use password login)
      user = await authService.createUser({
        email,
        password: crypto.randomBytes(32).toString('hex'),
        name,
        role: 'user',
      });
      console.log('[Auth] Auto-created SSO user:', email);
    }

    if (!user.isActive) {
      return htmlRedirect(`${config.FRONTEND_URL}/login?error=account_disabled`);
    }

    await authService.updateLastLogin(user.id);

    // Issue JWT cookie (same as password login)
    const secret = new TextEncoder().encode(config.JWT_SECRET);
    const token = await new SignJWT({ userId: user.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(config.JWT_EXPIRES_IN)
      .sign(secret);

    // Redirect based on role — use HTML redirect with Set-Cookie header
    const redirectPath = user.role === 'admin' ? '/' : '/my-documents';
    const redirectUrl = `${config.FRONTEND_URL}${redirectPath}`;
    const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${redirectUrl}"><script>window.location.href="${redirectUrl}";</script></head><body>Redirecting...</body></html>`;
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': `token=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=86400`,
      },
    });
  } catch (err) {
    console.error('[Auth] Microsoft callback error:', err);
    // Include error detail in redirect for debugging
    const detail = encodeURIComponent(err instanceof Error ? err.message : String(err));
    return htmlRedirect(`${config.FRONTEND_URL}/login?error=microsoft_auth_failed&detail=${detail}`);
  }
});

// POST /login
authRoutes.post('/login', async (c) => {
  try {
    const body = loginSchema.parse(await c.req.json());

    // Block SSO-domain users from password login
    if (body.email.toLowerCase().endsWith(SSO_DOMAIN)) {
      return c.json({ error: 'Please use "Sign in with Microsoft" for @homecare4all.org accounts' }, 400);
    }

    const user = await authService.findUserByEmail(body.email);
    if (!user) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    if (!user.isActive) {
      return c.json({ error: 'Account is disabled' }, 403);
    }

    const validPassword = await authService.verifyPassword(body.password, user.passwordHash);
    if (!validPassword) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    await authService.updateLastLogin(user.id);

    const secret = new TextEncoder().encode(config.JWT_SECRET);
    const token = await new SignJWT({ userId: user.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(config.JWT_EXPIRES_IN)
      .sign(secret);

    setCookie(c, 'token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400);
    }
    console.error('[Auth] Login error:', err);
    return c.json({ error: 'Login failed', details: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /logout
authRoutes.post('/logout', async (c) => {
  deleteCookie(c, 'token', {
    path: '/',
    secure: true,
    sameSite: 'None',
  });
  return c.json({ success: true });
});

// GET /me
authRoutes.get('/me', requireAuth, async (c) => {
  return c.json({ user: c.get('currentUser') });
});
