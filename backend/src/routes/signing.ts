import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { isTokenExpired, generateSecureToken, getTokenExpiryDate, generateSigningUrl } from '../utils/token.js';
import { stampSignature, saveStampedPdf, Placeholder } from '../services/pdf.service.js';
import { sendSigningRequest, sendCompletionEmail } from '../services/email.service.js';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../utils/config.js';

const signDocumentSchema = z.object({
  signatureData: z.string().min(1), // Base64 image or typed text
  signatureType: z.enum(['drawn', 'typed']),
  typedName: z.string().min(1),
  textFields: z.record(z.string()).optional(),
  confirmed: z.boolean(),
});

export const signingRoutes: FastifyPluginAsync = async (fastify) => {
  // Get signing session by token
  fastify.get<{ Params: { token: string } }>('/:token', async (request, reply) => {
    const { token } = request.params;

    const recipient = await prisma.recipient.findUnique({
      where: { token },
      include: {
        packet: {
          include: {
            recipients: {
              orderBy: { order: 'asc' },
              select: {
                id: true,
                roleName: true,
                name: true,
                order: true,
                status: true,
              },
            },
          },
        },
        signature: true,
      },
    });

    if (!recipient) {
      return reply.status(404).send({ error: 'Invalid or expired signing link' });
    }

    if (isTokenExpired(recipient.tokenExpiresAt)) {
      return reply.status(410).send({ error: 'This signing link has expired' });
    }

    if (recipient.status === 'signed') {
      return reply.status(400).send({ error: 'You have already signed this document' });
    }

    if (recipient.packet.status === 'cancelled') {
      return reply.status(400).send({ error: 'This signing request has been cancelled' });
    }

    if (recipient.packet.status === 'completed') {
      return reply.status(400).send({ error: 'This document has already been completed' });
    }

    // Check if it's this recipient's turn
    const pendingBefore = recipient.packet.recipients.filter(
      r => r.order < recipient.order && r.status !== 'signed'
    );

    if (pendingBefore.length > 0) {
      return reply.status(400).send({
        error: 'Waiting for previous signers to complete',
      });
    }

    // Log view event
    await prisma.auditLog.create({
      data: {
        packetId: recipient.packetId,
        recipientId: recipient.id,
        action: 'viewed',
        details: `Document viewed by ${recipient.name}`,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
    });

    const placeholders = JSON.parse(recipient.packet.placeholders as string);

    // Filter placeholders for this recipient's role
    // Include: SIGNATURE for this role, DATE (always shown), TEXT (always shown)
    const recipientPlaceholders = placeholders.filter(
      (p: Placeholder) => {
        // TEXT and DATE fields are shown for all signers
        if (p.type === 'TEXT' || p.type === 'DATE') return true;
        // SIGNATURE fields are matched by role (signer, signer1, etc.)
        // Also match if roles have same base (e.g., signer matches signer1)
        if (p.role === recipient.roleName) return true;
        if (recipient.roleName.startsWith(p.role) || p.role.startsWith(recipient.roleName)) return true;
        return false;
      }
    );

    return {
      recipient: {
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        roleName: recipient.roleName,
      },
      packet: {
        id: recipient.packet.id,
        name: recipient.packet.name,
        status: recipient.packet.status,
      },
      document: {
        fileName: recipient.packet.fileName,
        filePath: `/uploads/${recipient.packet.filePath}`,
      },
      placeholders: recipientPlaceholders,
      signers: recipient.packet.recipients.map(r => ({
        roleName: r.roleName,
        name: r.name,
        order: r.order,
        status: r.status,
        isCurrentUser: r.id === recipient.id,
      })),
    };
  });

  // Submit signature
  fastify.post<{
    Params: { token: string };
    Body: z.infer<typeof signDocumentSchema>;
  }>('/:token/sign', async (request, reply) => {
    const { token } = request.params;
    const validation = signDocumentSchema.safeParse(request.body);

    if (!validation.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { signatureData, signatureType, typedName, textFields, confirmed } = validation.data;

    if (!confirmed) {
      return reply.status(400).send({
        error: 'You must confirm you are the intended signer',
      });
    }

    const recipient = await prisma.recipient.findUnique({
      where: { token },
      include: {
        packet: {
          include: {
            recipients: {
              orderBy: { order: 'asc' },
              include: {
                signature: true,
              },
            },
          },
        },
      },
    });

    if (!recipient) {
      return reply.status(404).send({ error: 'Invalid or expired signing link' });
    }

    if (isTokenExpired(recipient.tokenExpiresAt)) {
      return reply.status(410).send({ error: 'This signing link has expired' });
    }

    if (recipient.status === 'signed') {
      return reply.status(400).send({ error: 'You have already signed this document' });
    }

    // Check order
    const pendingBefore = recipient.packet.recipients.filter(
      r => r.order < recipient.order && r.status !== 'signed'
    );

    if (pendingBefore.length > 0) {
      return reply.status(400).send({
        error: 'Waiting for previous signers',
      });
    }

    // Save signature
    await prisma.signature.create({
      data: {
        recipientId: recipient.id,
        signatureData,
        signatureType,
        typedName,
        textFields: textFields ? JSON.stringify(textFields) : null,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
    });

    // Update recipient status
    await prisma.recipient.update({
      where: { id: recipient.id },
      data: {
        status: 'signed',
        signedAt: new Date(),
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        packetId: recipient.packetId,
        recipientId: recipient.id,
        action: 'signed',
        details: `Document signed by ${recipient.name} (${recipient.email})`,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
    });

    // Check if all signers have completed
    const allRecipients = await prisma.recipient.findMany({
      where: { packetId: recipient.packetId },
      include: { signature: true },
      orderBy: { order: 'asc' },
    });

    const allSigned = allRecipients.every(r => r.status === 'signed');

    if (allSigned) {
      // All signatures collected - stamp PDF and complete
      const documentPath = path.join(
        process.cwd(),
        'uploads',
        recipient.packet.filePath
      );

      const placeholders = JSON.parse(recipient.packet.placeholders as string);

      // Build stamp configs for all signers
      const stamps = allRecipients.map(r => ({
        role: r.roleName,
        signatureData: {
          signatureImage: r.signature?.signatureData,
          typedName: r.signature?.typedName || r.name,
          signatureType: (r.signature?.signatureType || 'typed') as 'drawn' | 'typed',
          textFields: r.signature?.textFields
            ? JSON.parse(r.signature.textFields as string)
            : undefined,
        },
        timestamp: r.signedAt || new Date(),
      }));

      // Stamp the PDF
      const stampedPdf = await stampSignature(documentPath, stamps, placeholders);
      const signedPdfPath = await saveStampedPdf(stampedPdf, recipient.packetId);

      // Update packet
      await prisma.signingPacket.update({
        where: { id: recipient.packetId },
        data: {
          status: 'completed',
          signedPdfPath,
          completedAt: new Date(),
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          packetId: recipient.packetId,
          action: 'completed',
          details: 'All signatures collected, document completed',
        },
      });

      // Send completion emails
      const pdfBuffer = Buffer.from(stampedPdf);

      // Send to admin
      try {
        await sendCompletionEmail(
          config.ADMIN_EMAIL,
          'Admin',
          recipient.packet.name,
          pdfBuffer,
          true
        );
      } catch (err) {
        console.error('Failed to send admin notification:', err);
      }

      // Optionally send to all signers
      for (const r of allRecipients) {
        try {
          await sendCompletionEmail(r.email, r.name, recipient.packet.name, pdfBuffer, false);
        } catch (err) {
          console.error(`Failed to send completion email to ${r.email}:`, err);
        }
      }

      return {
        success: true,
        completed: true,
        message: 'Document has been fully signed',
      };
    } else {
      // Find next signer
      const nextRecipient = allRecipients.find(r => r.status === 'pending');

      if (nextRecipient) {
        // Generate new token for next signer
        const newToken = generateSecureToken();
        const tokenExpiresAt = getTokenExpiryDate();

        await prisma.recipient.update({
          where: { id: nextRecipient.id },
          data: {
            token: newToken,
            tokenExpiresAt,
            status: 'notified',
          },
        });

        // Update packet status
        await prisma.signingPacket.update({
          where: { id: recipient.packetId },
          data: { status: 'in_progress' },
        });

        // Send signing request to next signer
        const signingUrl = generateSigningUrl(newToken);
        await sendSigningRequest(
          nextRecipient.email,
          nextRecipient.name,
          recipient.packet.name,
          signingUrl,
          tokenExpiresAt
        );

        // Audit log
        await prisma.auditLog.create({
          data: {
            packetId: recipient.packetId,
            recipientId: nextRecipient.id,
            action: 'sent',
            details: `Signing request sent to ${nextRecipient.email}`,
          },
        });
      }

      return {
        success: true,
        completed: false,
        message: 'Your signature has been recorded',
      };
    }
  });

  // Download document PDF for preview
  fastify.get<{ Params: { token: string } }>('/:token/pdf', async (request, reply) => {
    const { token } = request.params;

    const recipient = await prisma.recipient.findUnique({
      where: { token },
      include: {
        packet: true,
      },
    });

    if (!recipient) {
      return reply.status(404).send({ error: 'Invalid token' });
    }

    const filePath = path.join(
      process.cwd(),
      'uploads',
      recipient.packet.filePath
    );

    try {
      const pdfBuffer = await fs.readFile(filePath);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${recipient.packet.fileName}"`)
        .send(pdfBuffer);
    } catch (err) {
      return reply.status(404).send({ error: 'PDF not found' });
    }
  });
};
