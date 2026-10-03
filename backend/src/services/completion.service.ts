import crypto from 'crypto';
import { db, signingPackets, recipients, auditLogs, formRoutes, eq } from '../db/index.js';
import {
  stampSignatureFromBuffer,
  parseTemplatePlaceholdersFromBuffer,
  Placeholder,
  PLACEHOLDER_VERSION,
  StampConfig,
} from './pdf.service.js';
import { sendCompletionEmail } from './email.service.js';
import { uploadToSharePoint, isSharePointConfigured } from './sharepoint.service.js';
import { downloadFile, uploadFile } from '../utils/storage.js';
import { config } from '../utils/config.js';

type PacketRow = typeof signingPackets.$inferSelect;

/**
 * Return the packet's placeholders, re-detecting them from the PDF when they were
 * produced by an older parser version (old geometry was frequently wrong).
 */
export async function getCurrentPlaceholders(packet: PacketRow): Promise<Placeholder[]> {
  let stored: Placeholder[] = [];
  try {
    stored = JSON.parse(packet.placeholders as string) || [];
  } catch {
    stored = [];
  }
  if (stored.length > 0 && stored.every(p => p.v === PLACEHOLDER_VERSION)) return stored;

  try {
    const fresh = await parseTemplatePlaceholdersFromBuffer(await downloadFile(packet.filePath));
    if (fresh.length > 0 || stored.length > 0) {
      await db.update(signingPackets)
        .set({ placeholders: JSON.stringify(fresh) })
        .where(eq(signingPackets.id, packet.id));
    }
    return fresh;
  } catch (err) {
    console.error(`[Placeholders] Re-parse failed for packet ${packet.id}:`, err);
    return stored;
  }
}

export function signedFileNameFor(packetName: string): string {
  return `${packetName.replace(/[<>:"/\\|?*]/g, '_').trim()}_signed.pdf`;
}

/**
 * Upload a completed packet's signed PDF to SharePoint and record the result.
 * Throws on failure (after recording the error on the packet).
 */
export async function uploadPacketToSharePoint(packetId: string, pdfBuffer?: Buffer, auditPrefix = '') {
  const packet = await db.query.signingPackets.findFirst({ where: eq(signingPackets.id, packetId) });
  if (!packet || !packet.signedPdfPath) throw new Error('Packet has no signed PDF');

  try {
    const buffer = pdfBuffer || await downloadFile(packet.signedPdfPath);
    const employeeName = packet.employeeName || packet.name;

    let subfolder: string | null = null;
    if (packet.formRouteId) {
      const formRoute = await db.query.formRoutes.findFirst({ where: eq(formRoutes.id, packet.formRouteId) });
      subfolder = formRoute?.sharepointFolder || null;
    }

    const result = await uploadToSharePoint(employeeName, signedFileNameFor(packet.name), buffer, subfolder);

    await db.update(signingPackets)
      .set({ sharepointUrl: result.url, sharepointFolder: result.folderName, sharepointError: null })
      .where(eq(signingPackets.id, packetId));

    const matchInfo = result.isExistingFolder
      ? `matched existing folder "${result.folderName}" (${Math.round(result.matchConfidence * 100)}% confidence)`
      : `created new folder "${result.folderName}"`;

    await db.insert(auditLogs).values({
      packetId, action: 'uploaded',
      details: `${auditPrefix}Signed PDF uploaded to SharePoint: ${result.url} — ${matchInfo}`,
    });

    return { ...result, matchInfo };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db.update(signingPackets).set({ sharepointError: errorMsg })
      .where(eq(signingPackets.id, packetId)).catch(() => {});
    await db.insert(auditLogs).values({
      packetId, action: 'upload_failed', details: `${auditPrefix}SharePoint upload failed: ${errorMsg}`,
    }).catch(() => {});
    throw err;
  }
}

/**
 * Build the signed PDF once every recipient has signed, store it, mark the packet
 * completed, email everyone and upload to SharePoint.
 * Safe to call again for a packet whose previous finalization failed.
 */
export async function finalizePacket(packetId: string): Promise<{ signedPdfPath: string; pdfHash: string }> {
  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, packetId),
  });
  if (!packet) throw new Error('Packet not found');
  if (packet.status === 'completed' && packet.signedPdfPath) {
    return { signedPdfPath: packet.signedPdfPath, pdfHash: packet.signedPdfHash || '' };
  }
  if (packet.status === 'cancelled') throw new Error('Packet has been cancelled');

  const allRecipients = await db.query.recipients.findMany({
    where: eq(recipients.packetId, packetId),
    with: { signature: true },
    orderBy: (r, { asc }) => [asc(r.order)],
  });
  if (allRecipients.length === 0 || !allRecipients.every(r => r.status === 'signed')) {
    throw new Error('Not all recipients have signed');
  }

  const documentBuffer = await downloadFile(packet.filePath);

  const stamps: StampConfig[] = allRecipients.map(r => ({
    role: r.roleName,
    order: r.order,
    name: r.name,
    email: r.email,
    signatureData: {
      signatureImage: r.signature?.signatureData,
      typedName: r.signature?.typedName || r.name,
      signatureType: (r.signature?.signatureType || 'typed') as 'drawn' | 'typed',
      textFields: r.signature?.textFields ? JSON.parse(r.signature.textFields as string) : undefined,
    },
    timestamp: r.signedAt || new Date(),
  }));

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = Buffer.from(await stampSignatureFromBuffer(documentBuffer, stamps));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.insert(auditLogs).values({
      packetId, action: 'completion_failed', details: `Failed to generate signed PDF: ${msg}`,
    }).catch(() => {});
    throw err;
  }

  const signedKey = `signed/signed_${packetId}_${Date.now()}.pdf`;
  await uploadFile(signedKey, pdfBuffer);
  const pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  await db.update(signingPackets)
    .set({ status: 'completed', signedPdfPath: signedKey, signedPdfHash: pdfHash, completedAt: new Date() })
    .where(eq(signingPackets.id, packetId));

  await db.insert(auditLogs).values({
    packetId, action: 'completed',
    details: `All signatures collected, document completed. PDF integrity hash (SHA-256): ${pdfHash}`,
  });

  try {
    await sendCompletionEmail(config.ADMIN_EMAIL, 'Admin', packet.name, pdfBuffer, true);
  } catch (err) {
    console.error('Failed to send admin notification:', err);
  }
  for (const r of allRecipients) {
    try {
      await sendCompletionEmail(r.email, r.name, packet.name, pdfBuffer, false);
    } catch (err) {
      console.error(`Failed to send completion email to ${r.email}:`, err);
    }
  }

  if (isSharePointConfigured()) {
    try {
      await uploadPacketToSharePoint(packetId, pdfBuffer);
    } catch (err) {
      console.error('[SharePoint] Failed to upload signed PDF:', err);
    }
  }

  return { signedPdfPath: signedKey, pdfHash };
}
