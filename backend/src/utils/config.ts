import dotenv from 'dotenv';
dotenv.config();

export const config = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ahs_signatures',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
  API_BASE_URL: process.env.API_BASE_URL || '',

  // JWT Authentication
  JWT_SECRET: process.env.JWT_SECRET || 'change-this-secret-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',

  // Signing links
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  TOKEN_EXPIRY_HOURS: parseInt(process.env.TOKEN_EXPIRY_HOURS || '72', 10),

  // Timezone used for dates stamped onto signed documents
  TIMEZONE: process.env.TIMEZONE || 'America/New_York',

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

  // JotForm integration
  JOTFORM_API_KEY: process.env.JOTFORM_API_KEY || '',
  JOTFORM_API_BASE: process.env.JOTFORM_API_BASE || 'https://hipaa-api.jotform.com',
  JOTFORM_WEBHOOK_SECRET: process.env.JOTFORM_WEBHOOK_SECRET || '',

  // Google Drive integration (OAuth2)
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',

  // SharePoint integration (Microsoft Graph API)
  SHAREPOINT_ENABLED: process.env.SHAREPOINT_ENABLED === 'true',
  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID || '',
  MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET || '',
  MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID || '',
  SHAREPOINT_SITE_ID: process.env.SHAREPOINT_SITE_ID || '',
  SHAREPOINT_DRIVE_ID: process.env.SHAREPOINT_DRIVE_ID || '',
  SHAREPOINT_SITE_URL: process.env.SHAREPOINT_SITE_URL || '',
  SHAREPOINT_LIBRARY_NAME: process.env.SHAREPOINT_LIBRARY_NAME || 'Documents',
  SHAREPOINT_BASE_FOLDER: process.env.SHAREPOINT_BASE_FOLDER || 'Signed Documents',
};
