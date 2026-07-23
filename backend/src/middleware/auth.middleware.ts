import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { jwtVerify } from 'jose';
import { authService } from '../services/auth.service.js';
import { config } from '../utils/config.js';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
}

// Hono context variable types
declare module 'hono' {
  interface ContextVariableMap {
    currentUser: CurrentUser;
  }
}

const getJwtSecret = () => new TextEncoder().encode(config.JWT_SECRET);

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const token = getCookie(c, 'token');
  if (!token) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const userId = (payload as any).userId as string;

    const user = await authService.findUserById(userId);
    if (!user) {
      return c.json({ error: 'User not found' }, 401);
    }

    if (!user.isActive) {
      return c.json({ error: 'Account is disabled' }, 403);
    }

    c.set('currentUser', {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    });

    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}

export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  const token = getCookie(c, 'token');
  if (!token) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const userId = (payload as any).userId as string;

    const user = await authService.findUserById(userId);
    if (!user) {
      return c.json({ error: 'User not found' }, 401);
    }

    if (!user.isActive) {
      return c.json({ error: 'Account is disabled' }, 403);
    }

    if (user.role !== 'admin') {
      return c.json({ error: 'Admin access required' }, 403);
    }

    c.set('currentUser', {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    });

    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}
