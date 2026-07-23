import { Hono } from 'hono';
import { db, signingPackets, recipients, signatures, auditLogs, formRoutes, eq } from '../db/index.js';
import { isTokenExpired, generateSecureToken, getTokenExpiryDate, generateSigningUrl } from '../utils/token.js';
import { stampSignatureFromBuffer, Placeholder } from '../services/pdf.service.js';
import { sendSigningRequest, sendCompletionEmail } from '../services/email.service.js';
import { downloadFile, uploadFile } from '../utils/storage.js';
import { z } from 'zod';
import crypto from 'crypto';
import { config } from '../utils/config.js';
import { uploadToSharePoint, isSharePointConfigured } from '../services/sharepoint.service.js';

const signDocumentSchema = z.object({
  signatureData: z.string().min(1),
  signatureType: z.enum(['drawn', 'typed']),
  typedName: z.string().min(1),
  textFields: z.record(z.string()).optional(),
  confirmed: z.boolean(),
  attestationAcknowledged: z.boolean(),
  attestationText: z.string().min(1),
});

export const signingRoutes = new Hono();

// GET /:token - Get signing session
signingRoutes.get('/:token', async (c) => {
  const token = c.req.param('token');

  const recipient = await db.query.recipients.findFirst({
    where: eq(recipients.token, token),
    with: {
      packet: {
        with: {
          recipients: {
            orderBy: (r, { asc }) => [asc(r.order)],
            columns: { id: true, roleName: true, name: true, order: true, status: true },
          },
        },
      },
      signature: true,
    },
  });

  if (!recipient) return c.json({ error: 'Invalid or expired signing link' }, 404);
  if (isTokenExpired(recipient.tokenExpiresAt)) return c.json({ error: 'This signing link has expired' }, 410);
  if (recipient.status === 'signed') return c.json({ error: 'You have already signed this document' }, 400);
  if (recipient.packet.status === 'cancelled') return c.json({ error: 'This signing request has been cancelled' }, 400);
  if (recipient.packet.status === 'completed') return c.json({ error: 'This document has already been completed' }, 400);

  const pendingBefore = recipient.packet.recipients.filter(
    r => r.order < recipient.order && r.status !== 'signed'
  );
  if (pendingBefore.length > 0) {
    return c.json({ error: 'Waiting for previous signers to complete' }, 400);
  }

  await db.insert(auditLogs).values({
    packetId: recipient.packetId,
    recipientId: recipient.id,
    action: 'viewed',
    details: `Document viewed by ${recipient.name}`,
    ipAddress: c.req.header('x-forwarded-for') || undefined,
    userAgent: c.req.header('user-agent') || undefined,
  });

  const placeholders = JSON.parse(recipient.packet.placeholders as string);
  const recipientPlaceholders = placeholders.filter(
    (p: Placeholder) => {
      if (p.type === 'TEXT' || p.type === 'DATE') return true;
      if (p.role === recipient.roleName) return true;
      if (recipient.roleName.startsWith(p.role) || p.role.startsWith(recipient.roleName)) return true;
      return false;
    }
  );

  return c.json({
    recipient: { id: recipient.id, name: recipient.name, email: recipient.email, roleName: recipient.roleName },
    packet: { id: recipient.packet.id, name: recipient.packet.name, status: recipient.packet.status },
    document: { fileName: recipient.packet.fileName, filePath: `/api/signing/${token}/pdf` },
    placeholders: recipientPlaceholders,
    signers: recipient.packet.recipients.map(r => ({
      roleName: r.roleName, name: r.name, order: r.order, status: r.status,
      isCurrentUser: r.id === recipient.id,
    })),
  });
});

// POST /:token/sign - Submit signature
signingRoutes.post('/:token/sign', async (c) => {
  const token = c.req.param('token');
  const validation = signDocumentSchema.safeParse(await c.req.json());

  if (!validation.success) {
    return c.json({ error: 'Validation failed', details: validation.error.errors }, 400);
  }

  const { signatureData, signatureType, typedName, textFields, confirmed, attestationAcknowledged, attestationText } = validation.data;

  if (!confirmed) return c.json({ error: 'You must confirm you are the intended signer' }, 400);
  if (!attestationAcknowledged) return c.json({ error: 'You must acknowledge the attestation before signing' }, 400);

  const recipient = await db.query.recipients.findFirst({
    where: eq(recipients.token, token),
    with: {
      packet: {
        with: {
          recipients: {
            orderBy: (r, { asc }) => [asc(r.order)],
            with: { signature: true },
          },
        },
      },
    },
  });

  if (!recipient) return c.json({ error: 'Invalid or expired signing link' }, 404);
  if (isTokenExpired(recipient.tokenExpiresAt)) return c.json({ error: 'This signing link has expired' }, 410);
  if (recipient.status === 'signed') return c.json({ error: 'You have already signed this document' }, 400);

  const pendingBefore = recipient.packet.recipients.filter(
    r => r.order < recipient.order && r.status !== 'signed'
  );
  if (pendingBefore.length > 0) return c.json({ error: 'Waiting for previous signers' }, 400);

  const signedAt = new Date();
  const clientIp = c.req.header('x-forwarded-for') || undefined;
  const userAgent = c.req.header('user-agent') || undefined;

  const identityRecord = JSON.stringify({
    email: recipient.email,
    name: recipient.name,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    ip: clientIp,
    userAgent,
    signedAt: signedAt.toISOString(),
  });

  await db.insert(signatures).values({
    recipientId: recipient.id,
    signatureData, signatureType, typedName,
    textFields: textFields ? JSON.stringify(textFields) : null,
    ipAddress: clientIp, userAgent, attestationText, identityRecord,
  });

  await db.update(recipients)
    .set({ status: 'signed', signedAt })
    .where(eq(recipients.id, recipient.id));

  await db.insert(auditLogs).values({
    packetId: recipient.packetId, recipientId: recipient.id,
    action: 'attestation_acknowledged',
    details: `Attestation acknowledged by ${recipient.name} (${recipient.email})`,
    ipAddress: clientIp, userAgent,
  });

  await db.insert(auditLogs).values({
    packetId: recipient.packetId, recipientId: recipient.id, action: 'signed',
    details: `Document signed by ${recipient.name} (${recipient.email}) — signature type: ${signatureType}, identity record preserved`,
    ipAddress: clientIp, userAgent,
  });

  const allRecipients = await db.query.recipients.findMany({
    where: eq(recipients.packetId, recipient.packetId),
    with: { signature: true },
    orderBy: (r, { asc }) => [asc(r.order)],
  });

  const allSigned = allRecipients.every(r => r.status === 'signed');

  if (allSigned) {
    const documentBuffer = await downloadFile(recipient.packet.filePath);
    const placeholders = JSON.parse(recipient.packet.placeholders as string);

    const stamps = allRecipients.map(r => ({
      role: r.roleName,
      signatureData: {
        signatureImage: r.signature?.signatureData,
        typedName: r.signature?.typedName || r.name,
        signatureType: (r.signature?.signatureType || 'typed') as 'drawn' | 'typed',
        textFields: r.signature?.textFields ? JSON.parse(r.signature.textFields as string) : undefined,
      },
      timestamp: r.signedAt || new Date(),
    }));

    const stampedPdf = await stampSignatureFromBuffer(documentBuffer, stamps, placeholders);

    const pdfBuffer = Buffer.from(stampedPdf);
    const signedKey = `signed/signed_${recipient.packetId}_${Date.now()}.pdf`;
    await uploadFile(signedKey, pdfBuffer);

    const pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    await db.update(signingPackets)
      .set({ status: 'completed', signedPdfPath: signedKey, signedPdfHash: pdfHash, completedAt: new Date() })
      .where(eq(signingPackets.id, recipient.packetId));

    await db.insert(auditLogs).values({
      packetId: recipient.packetId, action: 'completed',
      details: `All signatures collected, document completed. PDF integrity hash (SHA-256): ${pdfHash}`,
    });

    try {
      await sendCompletionEmail(config.ADMIN_EMAIL, 'Admin', recipient.packet.name, pdfBuffer, true);
    } catch (err) {
      console.error('Failed to send admin notification:', err);
    }

    for (const r of allRecipients) {
      try {
        await sendCompletionEmail(r.email, r.name, recipient.packet.name, pdfBuffer, false);
      } catch (err) {
        console.error(`Failed to send completion email to ${r.email}:`, err);
      }
    }

    // Upload to SharePoint if configured
    if (isSharePointConfigured()) {
      try {
        const fullPacket = await db.query.signingPackets.findFirst({
          where: eq(signingPackets.id, recipient.packetId),
        });
        const employeeName = fullPacket?.employeeName || recipient.packet.name;
        const signedFileName = `${recipient.packet.name}_signed.pdf`;

        let subfolder: string | null = null;
        if (fullPacket?.formRouteId) {
          const formRoute = await db.query.formRoutes.findFirst({
            where: eq(formRoutes.id, fullPacket.formRouteId),
          });
          subfolder = formRoute?.sharepointFolder || null;
        }

        const uploadResult = await uploadToSharePoint(employeeName, signedFileName, pdfBuffer, subfolder);

        await db.update(signingPackets)
          .set({ sharepointUrl: uploadResult.url, sharepointFolder: uploadResult.folderName, sharepointError: null })
          .where(eq(signingPackets.id, recipient.packetId));

        const matchInfo = uploadResult.isExistingFolder
          ? `matched existing folder "${uploadResult.folderName}" (${Math.round(uploadResult.matchConfidence * 100)}% confidence)`
          : `created new folder "${uploadResult.folderName}"`;

        await db.insert(auditLogs).values({
          packetId: recipient.packetId, action: 'uploaded', details: `Signed PDF uploaded to SharePoint: ${uploadResult.url} — ${matchInfo}`,
        });
      } catch (err) {
        console.error('[SharePoint] Failed to upload signed PDF:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        await db.update(signingPackets)
          .set({ sharepointError: errorMsg })
          .where(eq(signingPackets.id, recipient.packetId))
          .catch(() => {});
        await db.insert(auditLogs).values({
          packetId: recipient.packetId, action: 'upload_failed', details: `SharePoint upload failed: ${errorMsg}`,
        }).catch(() => {});
      }
    }

    return c.json({ success: true, completed: true, message: 'Document has been fully signed' });
  } else {
    const nextRecipient = allRecipients.find(r => r.status === 'pending');

    if (nextRecipient) {
      const newToken = generateSecureToken();
      const tokenExpiresAt = getTokenExpiryDate();

      await db.update(recipients)
        .set({ token: newToken, tokenExpiresAt, status: 'notified' })
        .where(eq(recipients.id, nextRecipient.id));

      await db.update(signingPackets)
        .set({ status: 'in_progress' })
        .where(eq(signingPackets.id, recipient.packetId));

      const signingUrl = generateSigningUrl(newToken);
      await sendSigningRequest(nextRecipient.email, nextRecipient.name, recipient.packet.name, signingUrl, tokenExpiresAt);

      await db.insert(auditLogs).values({
        packetId: recipient.packetId, recipientId: nextRecipient.id,
        action: 'sent', details: `Signing request sent to ${nextRecipient.email}`,
      });
    }

    return c.json({ success: true, completed: false, message: 'Your signature has been recorded' });
  }
});

// GET /:token/confirmation
signingRoutes.get('/:token/confirmation', async (c) => {
  const token = c.req.param('token');

  const recipient = await db.query.recipients.findFirst({
    where: eq(recipients.token, token),
    with: { packet: true, signature: true },
  });

  if (!recipient) return c.json({ error: 'Invalid token' }, 404);
  if (!recipient.signature) return c.json({ error: 'No signature found for this token' }, 400);

  const sig = recipient.signature;
  const identity = sig.identityRecord ? JSON.parse(sig.identityRecord) : null;

  return c.json({
    confirmationId: sig.id,
    signer: { name: recipient.name, email: recipient.email, role: recipient.roleName },
    document: { name: recipient.packet.name, fileName: recipient.packet.fileName },
    signature: { type: sig.signatureType, typedName: sig.typedName, signedAt: recipient.signedAt?.toISOString() },
    attestation: { text: sig.attestationText, acknowledgedAt: sig.createdAt.toISOString() },
    identity: identity || { ip: sig.ipAddress, userAgent: sig.userAgent, signedAt: sig.createdAt.toISOString() },
  });
});

// GET /:token/pdf - Download document PDF
signingRoutes.get('/:token/pdf', async (c) => {
  const token = c.req.param('token');

  const recipient = await db.query.recipients.findFirst({
    where: eq(recipients.token, token),
    with: { packet: true },
  });

  if (!recipient) return c.json({ error: 'Invalid token' }, 404);

  try {
    const pdfBuffer = await downloadFile(recipient.packet.filePath);
    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${recipient.packet.fileName}"`,
      },
    });
  } catch {
    return c.json({ error: 'PDF not found' }, 404);
  }
});
