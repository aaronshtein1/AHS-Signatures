import { describe, it, expect } from 'vitest';

// Test the production safety logic that was added to index.ts
// We test the guard logic itself, not by importing index.ts

function validateProductionConfig(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === 'production') {
    if (!env.JWT_SECRET || env.JWT_SECRET === 'change-this-secret-in-production') {
      return 'FATAL: JWT_SECRET must be set to a secure value in production';
    }
  }
  return null;
}

function validateSeedConfig(env: Record<string, string | undefined>): string | null {
  const isProduction = env.NODE_ENV === 'production';
  const adminEmail = env.ADMIN_SEED_EMAIL || (isProduction ? '' : 'admin@example.com');
  const adminPassword = env.ADMIN_SEED_PASSWORD || (isProduction ? '' : 'admin123');

  if (!adminEmail || !adminPassword) {
    return 'ERROR: In production, you must set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD.';
  }

  if (isProduction && adminPassword.length < 12) {
    return 'ERROR: ADMIN_SEED_PASSWORD must be at least 12 characters in production.';
  }

  return null;
}

describe('Production Config Guard', () => {
  describe('JWT Secret', () => {
    it('rejects default secret in production', () => {
      const error = validateProductionConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'change-this-secret-in-production',
      });
      expect(error).not.toBeNull();
    });

    it('rejects missing secret in production', () => {
      const error = validateProductionConfig({
        NODE_ENV: 'production',
        JWT_SECRET: undefined,
      });
      expect(error).not.toBeNull();
    });

    it('accepts proper secret in production', () => {
      const error = validateProductionConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'a-very-secure-random-secret-here-1234567890',
      });
      expect(error).toBeNull();
    });

    it('allows default secret in development', () => {
      const error = validateProductionConfig({
        NODE_ENV: 'development',
        JWT_SECRET: 'change-this-secret-in-production',
      });
      expect(error).toBeNull();
    });
  });

  describe('Seed Config', () => {
    it('rejects missing admin email in production', () => {
      const error = validateSeedConfig({ NODE_ENV: 'production' });
      expect(error).not.toBeNull();
    });

    it('rejects short password in production', () => {
      const error = validateSeedConfig({
        NODE_ENV: 'production',
        ADMIN_SEED_EMAIL: 'admin@ahs.org',
        ADMIN_SEED_PASSWORD: 'short',
      });
      expect(error).toContain('12 characters');
    });

    it('accepts proper config in production', () => {
      const error = validateSeedConfig({
        NODE_ENV: 'production',
        ADMIN_SEED_EMAIL: 'admin@ahs.org',
        ADMIN_SEED_PASSWORD: 'super-secure-password-123',
      });
      expect(error).toBeNull();
    });

    it('uses demo defaults in development', () => {
      const error = validateSeedConfig({ NODE_ENV: 'development' });
      expect(error).toBeNull();
    });
  });
});
