import { Hono } from 'hono';
import { db, signingPackets, recipients, signatures, auditLogs, eq } from '../db/index.js';
import { isTokenExpired, generateSecureToken, getTokenExpiryDate, generateSigningUrl } from '../utils/token.js';
import { placeholdersForRecipient } from '../services/pdf.service.js';
import { sendSigningRequest } from '../services/email.service.js';
import { finalizePacket, getCurrentPlaceholders } from '../services/completion.service.js';
import { downloadFile } from '../utils/storage.js';
import { z } from 'zod';
import crypto from 'crypto';

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

  const { recipients: packetRecipients, ...packetRow } = recipient.packet;
  const placeholders = await getCurrentPlaceholders(packetRow as any);
  const self = packetRecipients.find(r => r.id === recipient.id)!;
  const recipientPlaceholders = placeholdersForRecipient(placeholders, self, packetRecipients);

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
  if (recipient.packet.status === 'cancelled') return c.json({ error: 'This signing request has been cancelled' }, 400);
  if (recipient.packet.status === 'completed') return c.json({ error: 'This document has already been completed' }, 400);

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

  try {
    await db.transaction(async (tx) => {
      await tx.insert(signatures).values({
        recipientId: recipient.id,
        signatureData, signatureType, typedName,
        textFields: textFields ? JSON.stringify(textFields) : null,
        ipAddress: clientIp, userAgent, attestationText, identityRecord,
      });
      await tx.update(recipients)
        .set({ status: 'signed', signedAt })
        .where(eq(recipients.id, recipient.id));
    });
  } catch (err: any) {
    // Unique violation on recipientId: a duplicate submit (double click / two tabs)
    if (err?.code === '23505' || err?.cause?.code === '23505') {
      return c.json({ error: 'You have already signed this document' }, 409);
    }
    throw err;
  }

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
    try {
      await finalizePacket(recipient.packetId);
    } catch (err) {
      // The signature itself is saved; an admin can retry finalization from the packet page.
      console.error(`[Signing] Finalization failed for packet ${recipient.packetId}:`, err);
      return c.json({
        success: true, completed: false,
        message: 'Your signature has been recorded. The final document is still being processed.',
      });
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
  if (isTokenExpired(recipient.tokenExpiresAt)) return c.json({ error: 'This signing link has expired' }, 410);
  if (recipient.packet.status === 'cancelled') return c.json({ error: 'This signing request has been cancelled' }, 400);

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
