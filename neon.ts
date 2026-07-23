import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  preview: {
    functions: {
      api: {
        name: "AHS Signatures API",
        source: "backend/src/index.ts",
        env: {
          JWT_SECRET: process.env.JWT_SECRET || "change-this-secret-in-production",
          JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "24h",
          CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:3000",
          FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3000",
          API_BASE_URL: process.env.API_BASE_URL || "",
          TOKEN_EXPIRY_HOURS: process.env.TOKEN_EXPIRY_HOURS || "72",
          EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || "smtp",
          SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || "",
          SMTP_HOST: process.env.SMTP_HOST || "",
          SMTP_PORT: process.env.SMTP_PORT || "587",
          SMTP_USER: process.env.SMTP_USER || "",
          SMTP_PASS: process.env.SMTP_PASS || "",
          SMTP_SECURE: process.env.SMTP_SECURE || "false",
          EMAIL_FROM: process.env.EMAIL_FROM || "signatures@example.com",
          EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || "AHS Signatures",
          ADMIN_EMAIL: process.env.ADMIN_EMAIL || "admin@example.com",
          JOTFORM_API_KEY: process.env.JOTFORM_API_KEY || "",
          JOTFORM_API_BASE: process.env.JOTFORM_API_BASE || "https://hipaa-api.jotform.com",
          JOTFORM_WEBHOOK_SECRET: process.env.JOTFORM_WEBHOOK_SECRET || "",
          GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
          GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
          SHAREPOINT_ENABLED: process.env.SHAREPOINT_ENABLED || "false",
          MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID || "",
          MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET || "",
          MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID || "",
          SHAREPOINT_SITE_ID: process.env.SHAREPOINT_SITE_ID || "",
          SHAREPOINT_DRIVE_ID: process.env.SHAREPOINT_DRIVE_ID || "",
          SHAREPOINT_SITE_URL: process.env.SHAREPOINT_SITE_URL || "",
          SHAREPOINT_LIBRARY_NAME: process.env.SHAREPOINT_LIBRARY_NAME || "Documents",
          SHAREPOINT_BASE_FOLDER: process.env.SHAREPOINT_BASE_FOLDER || "Signed Documents",
        },
      },
    },
    buckets: {
      documents: { access: "private" },
    },
  },
});
