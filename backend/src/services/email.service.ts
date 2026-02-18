import nodemailer from 'nodemailer';
import sgMail from '@sendgrid/mail';
import { config } from '../utils/config.js';

// Initialize SendGrid if configured
if (config.EMAIL_PROVIDER === 'sendgrid' && config.SENDGRID_API_KEY) {
  sgMail.setApiKey(config.SENDGRID_API_KEY);
}

// Create SMTP transporter
const smtpTransporter = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  auth: config.SMTP_USER ? {
    user: config.SMTP_USER,
    pass: config.SMTP_PASS,
  } : undefined,
});

// Log SMTP configuration on startup (without password)
console.log(`[Email] SMTP configured: ${config.SMTP_HOST}:${config.SMTP_PORT}, user: ${config.SMTP_USER || '(none)'}, secure: ${config.SMTP_SECURE}`);

interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

/**
 * Send an email using configured provider
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
  const { to, subject, text, html, attachments } = options;

  if (config.EMAIL_PROVIDER === 'sendgrid' && config.SENDGRID_API_KEY) {
    await sgMail.send({
      to,
      from: {
        email: config.EMAIL_FROM,
        name: config.EMAIL_FROM_NAME,
      },
      subject,
      text,
      html,
      attachments: attachments?.map(a => ({
        filename: a.filename,
        content: a.content.toString('base64'),
        type: a.contentType,
        disposition: 'attachment',
      })),
    });
  } else {
    try {
      console.log(`[Email] Sending email to: ${to}, subject: "${subject}"`);
      const result = await smtpTransporter.sendMail({
        from: `"${config.EMAIL_FROM_NAME}" <${config.EMAIL_FROM}>`,
        to,
        subject,
        text,
        html,
        attachments: attachments?.map(a => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      console.log(`[Email] Email sent successfully! Message ID: ${result.messageId}`);
    } catch (err: any) {
      console.error(`[Email] Failed to send email:`, err.message);
      // In development, log email details instead of failing if SMTP isn't available
      if (err.code === 'ESOCKET' || err.code === 'ECONNREFUSED') {
        console.log('\n========== EMAIL (SMTP unavailable - logged for dev) ==========');
        console.log(`To: ${to}`);
        console.log(`Subject: ${subject}`);
        console.log(`Text:\n${text}`);
        console.log('================================================================\n');
        return; // Don't throw in dev mode when SMTP is unavailable
      }
      throw err;
    }
  }
}

/**
 * Send signing request email to recipient
 */
export async function sendSigningRequest(
  recipientEmail: string,
  recipientName: string,
  packetName: string,
  signingUrl: string,
  expiresAt: Date
): Promise<void> {
  const expiryDate = expiresAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  await sendEmail({
    to: recipientEmail,
    subject: `Signature Required: ${packetName}`,
    text: `
Hello ${recipientName},

You have been requested to sign a document: ${packetName}

Please click the link below to review and sign the document:
${signingUrl}

This link will expire on ${expiryDate}.

If you did not expect this request, please ignore this email.

Best regards,
${config.EMAIL_FROM_NAME}
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button {
      display: inline-block;
      background-color: #2563eb;
      color: white !important;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 6px;
      margin: 20px 0;
    }
    .footer { margin-top: 30px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Signature Required</h2>
    <p>Hello ${recipientName},</p>
    <p>You have been requested to sign a document: <strong>${packetName}</strong></p>
    <p>Please click the button below to review and sign the document:</p>
    <a href="${signingUrl}" class="button">Review & Sign Document</a>
    <p>Or copy this link: <a href="${signingUrl}">${signingUrl}</a></p>
    <p><em>This link will expire on ${expiryDate}.</em></p>
    <div class="footer">
      <p>If you did not expect this request, please ignore this email.</p>
      <p>Best regards,<br>${config.EMAIL_FROM_NAME}</p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}

/**
 * Send completion notification with signed PDF
 */
export async function sendCompletionEmail(
  email: string,
  name: string,
  packetName: string,
  pdfBuffer: Buffer,
  isAdmin: boolean = false
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Document Signed: ${packetName}`,
    text: `
Hello ${name},

${isAdmin
  ? `The document "${packetName}" has been fully signed by all parties.`
  : `The document "${packetName}" has been completed.`
}

The signed document is attached to this email.

Best regards,
${config.EMAIL_FROM_NAME}
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .success { color: #059669; }
    .footer { margin-top: 30px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2 class="success">✓ Document Signed</h2>
    <p>Hello ${name},</p>
    <p>${isAdmin
      ? `The document "<strong>${packetName}</strong>" has been fully signed by all parties.`
      : `The document "<strong>${packetName}</strong>" has been completed.`
    }</p>
    <p>The signed document is attached to this email.</p>
    <div class="footer">
      <p>Best regards,<br>${config.EMAIL_FROM_NAME}</p>
    </div>
  </div>
</body>
</html>
    `.trim(),
    attachments: [{
      filename: `${packetName.replace(/[^a-zA-Z0-9]/g, '_')}_signed.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  });
}

/**
 * Send reminder email
 */
export async function sendReminderEmail(
  recipientEmail: string,
  recipientName: string,
  packetName: string,
  signingUrl: string,
  expiresAt: Date
): Promise<void> {
  const expiryDate = expiresAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  await sendEmail({
    to: recipientEmail,
    subject: `Reminder: Signature Required for ${packetName}`,
    text: `
Hello ${recipientName},

This is a reminder that your signature is still required for: ${packetName}

Please click the link below to review and sign the document:
${signingUrl}

This link will expire on ${expiryDate}.

Best regards,
${config.EMAIL_FROM_NAME}
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .reminder { background-color: #fef3c7; padding: 15px; border-radius: 6px; margin: 15px 0; }
    .button {
      display: inline-block;
      background-color: #2563eb;
      color: white !important;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 6px;
      margin: 20px 0;
    }
    .footer { margin-top: 30px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Reminder: Signature Required</h2>
    <div class="reminder">
      <p>Hello ${recipientName},</p>
      <p>This is a friendly reminder that your signature is still required for: <strong>${packetName}</strong></p>
    </div>
    <a href="${signingUrl}" class="button">Review & Sign Document</a>
    <p><em>This link will expire on ${expiryDate}.</em></p>
    <div class="footer">
      <p>Best regards,<br>${config.EMAIL_FROM_NAME}</p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}
