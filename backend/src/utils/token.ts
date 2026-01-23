import crypto from 'crypto';
import { config } from './config.js';

/**
 * Generate a secure random token for signing links
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Calculate token expiry date
 */
export function getTokenExpiryDate(): Date {
  const expiryDate = new Date();
  expiryDate.setHours(expiryDate.getHours() + config.TOKEN_EXPIRY_HOURS);
  return expiryDate;
}

/**
 * Generate a signing URL for a recipient
 */
export function generateSigningUrl(token: string): string {
  return `${config.FRONTEND_URL}/sign/${token}`;
}

/**
 * Check if a token is expired
 */
export function isTokenExpired(expiryDate: Date): boolean {
  return new Date() > new Date(expiryDate);
}
