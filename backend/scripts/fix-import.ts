/**
 * Fix script: Updates imported packets that were incorrectly parsed.
 * - Fixes packet names (category was wrong due to dash parsing bug)
 * - Changes status from "draft" to "pending_assignment" for packets without valid signers
 * - Adds recipients where they should have been created
 *
 * Usage: cd backend && npx tsx scripts/fix-import.ts
 */

import { PrismaClient } from '@prisma/client';
import path from 'path';
import { generateSecureToken, getTokenExpiryDate } from '../src/utils/token.js';

const prisma = new PrismaClient();

const SIGNERS: Record<string, { email: string; name: string }> = {
  Tovah: { email: 'tovah@ahshomecare.com', name: 'Tovah' },
  Kimberlee: { email: 'kimberlee@ahshomecare.com', name: 'Kimberlee' },
  Liz: { email: 'liz@ahshomecare.com', name: 'Liz' },
  Kathleen: { email: 'kathleen@ahshomecare.com', name: 'Kathleen' },
  Cynthia: { email: 'cynthia@ahshomecare.com', name: 'Cynthia' },
};

const KNOWN_CATEGORIES = [
  'Evals and Post Test', 'Evals', 'In-service', 'In-Service',
  'NHTD', 'Pre-orientation', 'Pre-Orientation', 'HR-Orientation', 'HR-orientation',
];
const sortedCategories = [...KNOWN_CATEGORIES].sort((a, b) => b.length - a.length);

function parseFolderPath(relativePath: string) {
  const parts = relativePath.split(/[\\/]/);
  const date = parts[0];
  const catPart = parts[1];
  let category = catPart;
  let signer: string | null = null;

  for (const knownCat of sortedCategories) {
    if (catPart.toLowerCase().startsWith(knownCat.toLowerCase())) {
      category = knownCat;
      const remainder = catPart.slice(knownCat.length).trim();
      const signerMatch = remainder.match(/^-\s*(.+)$/);
      if (signerMatch) signer = signerMatch[1].trim();
      break;
    }
  }

  if (!signer && parts.length >= 4) {
    const possibleSigner = parts[2];
    if (Object.keys(SIGNERS).some((s) => s.toLowerCase() === possibleSigner.toLowerCase())) {
      signer = possibleSigner;
    }
  }

  if (signer && !Object.keys(SIGNERS).some((s) => s.toLowerCase() === signer!.toLowerCase())) {
    signer = null;
  }

  category = category
    .replace(/^Pre-[Oo]rientation$/i, 'Pre-orientation')
    .replace(/^Evals$/i, 'Evals')
    .replace(/^In-[Ss]ervice$/i, 'In-service')
    .replace(/^NHTD$/i, 'NHTD')
    .replace(/^HR-[Oo]rientation$/i, 'HR-Orientation');

  return { date, category, signer };
}

function parseEmployeeName(filename: string): string {
  const base = filename.replace(/\.pdf$/i, '');
  const categories = ['Pre-orientation', 'In-service', 'In-Service', 'Evals', 'Evals & Post Test', 'NHTD', 'HR-Orientation'];

  if (!base.startsWith('HHA-PCA-')) {
    const underscoreIdx = base.indexOf('_');
    if (underscoreIdx > 0) {
      const left = base.slice(0, underscoreIdx);
      const right = base.slice(underscoreIdx + 1);
      if (categories.some((c) => c.toLowerCase() === left.toLowerCase())) return right.replace(/-/g, ' ');
      return left.replace(/-/g, ' ');
    }
    return base.replace(/-/g, ' ');
  }

  let nameStr = base;
  const prefixes = [
    'HHA-PCA-Evals-and-Post-Test-', 'HHA-PCA-In-service-', 'HHA-PCA-NHTD-',
    'HHA-PCA-Pre-orientation-NYC-', 'HHA-PCA-Pre-orientation-Upstate-v2-',
    'HHA-PCA-Pre-orientation-Upstate-', 'HHA-PCA-HR-Orientation-',
  ];
  for (const prefix of prefixes) {
    if (nameStr.startsWith(prefix)) { nameStr = nameStr.slice(prefix.length); break; }
  }
  nameStr = nameStr.replace(/-\d{3}-\d{2}-\d{4}$/, '');
  nameStr = nameStr.replace(/-Age\d+-WOTC\d+$/, '');
  return nameStr.replace(/-/g, ' ');
}

async function main() {
  console.log('=== Fixing imported packets ===\n');

  // Get all imported packets (identified by having an 'imported' audit log)
  const importedLogs = await prisma.auditLog.findMany({
    where: { action: 'imported' },
    select: { packetId: true, details: true },
  });

  const importedPacketIds = importedLogs.map((l) => l.packetId);
  console.log(`Found ${importedPacketIds.length} imported packets to check\n`);

  // Get the packets with their recipients
  const packets = await prisma.signingPacket.findMany({
    where: { id: { in: importedPacketIds } },
    include: { recipients: true },
  });

  let namesFixed = 0;
  let statusFixed = 0;
  let recipientsAdded = 0;
  let alreadyCorrect = 0;

  for (const packet of packets) {
    // Find the import audit log to get the original relative path
    const log = importedLogs.find((l) => l.packetId === packet.id);
    if (!log?.details) continue;

    // Extract relative path from audit log: "Imported from {path} (assigned to {signer})"
    const pathMatch = log.details.match(/^Imported from (.+?)(?: \((?:assigned to .+|unassigned)\))?$/);
    if (!pathMatch) continue;

    const relativePath = pathMatch[1];
    const { date, category, signer } = parseFolderPath(relativePath);
    const employeeName = parseEmployeeName(packet.fileName);
    const correctName = `${category} - ${employeeName} (${date})`;

    let needsUpdate = false;
    const updates: any = {};

    // Fix name if wrong
    if (packet.name !== correctName) {
      updates.name = correctName;
      namesFixed++;
      needsUpdate = true;
    }

    // Fix status: if no valid signer but status is "draft", change to "pending_assignment"
    if (!signer && packet.status === 'draft' && packet.recipients.length === 0) {
      updates.status = 'pending_assignment';
      statusFixed++;
      needsUpdate = true;
    }

    // Add recipient if signer is known but no recipient exists
    if (signer && packet.recipients.length === 0) {
      const signerInfo = Object.entries(SIGNERS).find(
        ([key]) => key.toLowerCase() === signer.toLowerCase()
      );
      if (signerInfo) {
        const [, signerData] = signerInfo;
        const placeholders = JSON.parse(packet.placeholders || '[]');
        let signerRole = 'signer1';
        const sigRoles = placeholders
          .filter((p: any) => p.type === 'SIGNATURE')
          .map((p: any) => p.role);
        if (sigRoles.length > 0) signerRole = sigRoles[0];

        await prisma.recipient.create({
          data: {
            packetId: packet.id,
            roleName: signerRole,
            name: signerData.name,
            email: signerData.email,
            order: 1,
            token: generateSecureToken(),
            tokenExpiresAt: getTokenExpiryDate(),
            status: 'pending',
          },
        });
        recipientsAdded++;
        needsUpdate = true;
      }
    }

    if (needsUpdate && Object.keys(updates).length > 0) {
      await prisma.signingPacket.update({
        where: { id: packet.id },
        data: updates,
      });
    }

    if (!needsUpdate) alreadyCorrect++;
  }

  console.log('=== Fix Complete ===');
  console.log(`  Names corrected: ${namesFixed}`);
  console.log(`  Status fixed (draft -> pending_assignment): ${statusFixed}`);
  console.log(`  Recipients added: ${recipientsAdded}`);
  console.log(`  Already correct: ${alreadyCorrect}`);

  // Final stats
  const statsByStatus = await prisma.signingPacket.groupBy({
    by: ['status'],
    _count: true,
  });
  console.log('\n--- Packets by status ---');
  for (const s of statsByStatus) {
    console.log(`  ${s.status}: ${s._count}`);
  }

  const totalRecipients = await prisma.recipient.count();
  console.log(`\n  Total recipients: ${totalRecipients}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
