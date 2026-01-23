import dotenv from 'dotenv';
dotenv.config();

export const config = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',

  // Signing links
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  TOKEN_EXPIRY_HOURS: parseInt(process.env.TOKEN_EXPIRY_HOURS || '72', 10),

  // Email configuration
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || 'smtp', // 'sendgrid' or 'smtp'
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || '',
  SMTP_HOST: process.env.SMTP_HOST || 'localhost',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '1025', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',

  EMAIL_FROM: process.env.EMAIL_FROM || 'signatures@example.com',
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'AHS Signatures',

  // Admin notification
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@example.com',
};
