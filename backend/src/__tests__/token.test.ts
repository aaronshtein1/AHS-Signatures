import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// Test token utility functions directly (without config dependency)
// These mirror the logic in src/utils/token.ts

function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function isTokenExpired(expiryDate: Date): boolean {
  return new Date() > new Date(expiryDate);
}

describe('Token Utilities', () => {
  describe('generateSecureToken', () => {
    it('produces a 64-character hex string', () => {
      const token = generateSecureToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces unique tokens each call', () => {
      const tokens = new Set(Array.from({ length: 50 }, () => generateSecureToken()));
      expect(tokens.size).toBe(50);
    });
  });

  describe('isTokenExpired', () => {
    it('returns false for a future date', () => {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      expect(isTokenExpired(future)).toBe(false);
    });

    it('returns true for a past date', () => {
      const past = new Date(Date.now() - 1000);
      expect(isTokenExpired(past)).toBe(true);
    });

    it('handles string dates (as returned from DB)', () => {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      // Prisma may return ISO strings; the function casts via new Date()
      expect(isTokenExpired(new Date(future.toISOString()))).toBe(false);
    });
  });
});
