/**
 * Bulk import script for AHS documents from OneDrive ZIP export.
 *
 * Usage:
 *   cd backend && npx tsx scripts/import-docs.ts
 *
 * What it does:
 *   1. Creates signer users (Tovah, Kimberlee, Liz, Kathleen, Cynthia) if they don't exist
 *   2. Walks the extracted ZIP directory structure
 *   3. For each PDF:
 *      - Parses the filename to extract employee name, category, date
 *      - Extracts signature placeholders from the PDF
 *      - Creates a SigningPacket with the PDF copied to uploads/
 *      - Assigns the appropriate signer as a Recipient (status: pending)
 *      - Sets packet status to "pending_assignment" if no signer specified, else "draft"
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { parseTemplatePlaceholders } from '../src/services/pdf.service.js';
import { generateSecureToken, getTokenExpiryDate } from '../src/utils/token.js';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

// --- Configuration ---
const DOCS_DIR = path.join(process.env.TEMP || '/tmp', 'ahs-docs');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'packets');
const DEFAULT_PASSWORD = 'AHS2026!';

// Signer definitions - these are the supervisors/evaluators who sign documents
const SIGNERS: Record<string, { email: string; name: string }> = {
  Tovah: { email: 'tovah@ahshomecare.com', name: 'Tovah' },
  Kimberlee: { email: 'kimberlee@ahshomecare.com', name: 'Kimberlee' },
  Liz: { email: 'liz@ahshomecare.com', name: 'Liz' },
  Kathleen: { email: 'kathleen@ahshomecare.com', name: 'Kathleen' },
  Cynthia: { email: 'cynthia@ahshomecare.com', name: 'Cynthia' },
};

// --- Helpers ---

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// Known category names that appear in folder paths
const KNOWN_CATEGORIES = [
  'Evals and Post Test',
  'Evals',
  'In-service',
  'In-Service',
  'NHTD',
  'Pre-orientation',
  'Pre-Orientation',
  'HR-Orientation',
  'HR-orientation',
];

/**
 * Parse the folder path to extract date, category, and signer.
 * Examples:
 *   "10.16.25/Evals - Tovah/file.pdf"       → { date: "10.16.25", category: "Evals", signer: "Tovah" }
 *   "10.16.25/Pre-orientation/file.pdf"       → { date: "10.16.25", category: "Pre-orientation", signer: null }
 *   "12.11.25/Evals/Kimberlee/file.pdf"       → { date: "12.11.25", category: "Evals", signer: "Kimberlee" }
 *   "12.11.25/NHTD/Kimberlee/file.pdf"        → { date: "12.11.25", category: "NHTD", signer: "Kimberlee" }
 *   "11.20.25/Pre-Orientation - Tovah/file.pdf"→ { date: "11.20.25", category: "Pre-orientation", signer: "Tovah" }
 */
function parseFolderPath(relativePath: string): {
  date: string;
  category: string;
  signer: string | null;
} {
  const parts = relativePath.split(/[\\/]/);
  const date = parts[0];
  const catPart = parts[1];
  let category = catPart;
  let signer: string | null = null;

  // Try to match "KnownCategory - SignerName" or "KnownCategory/SignerName"
  // Sort known categories by length descending so longer names match first
  const sortedCategories = [...KNOWN_CATEGORIES].sort((a, b) => b.length - a.length);

  for (const knownCat of sortedCategories) {
    // Check "Category - Signer" pattern (e.g., "Evals - Tovah", "Pre-Orientation - Tovah")
    if (catPart.toLowerCase().startsWith(knownCat.toLowerCase())) {
      category = knownCat;
      const remainder = catPart.slice(knownCat.length).trim();
      // If there's " - SignerName" after the category
      const signerMatch = remainder.match(/^-\s*(.+)$/);
      if (signerMatch) {
        signer = signerMatch[1].trim();
      }
      break;
    }
  }

  // Pattern: "Category/SignerName/file.pdf" (e.g., 12.11.25/Evals/Kimberlee/file.pdf)
  if (!signer && parts.length >= 4) {
    const possibleSigner = parts[2];
    if (Object.keys(SIGNERS).some((s) => s.toLowerCase() === possibleSigner.toLowerCase())) {
      signer = possibleSigner;
    }
  }

  // Only keep signer if it matches a known signer name
  if (signer && !Object.keys(SIGNERS).some((s) => s.toLowerCase() === signer!.toLowerCase())) {
    signer = null;
  }

  // Normalize category
  category = category
    .replace(/^Pre-[Oo]rientation$/i, 'Pre-orientation')
    .replace(/^Evals$/i, 'Evals')
    .replace(/^In-[Ss]ervice$/i, 'In-service')
    .replace(/^NHTD$/i, 'NHTD')
    .replace(/^HR-[Oo]rientation$/i, 'HR-Orientation');

  return { date, category, signer };
}

/**
 * Parse a PDF filename to extract employee name.
 * Patterns:
 *   HHA-PCA-Evals-and-Post-Test-FirstName-LastName-SSN.pdf
 *   HHA-PCA-In-service-FirstName-LastName-SSN.pdf
 *   HHA-PCA-NHTD-FirstName-LastName-SSN.pdf
 *   HHA-PCA-Pre-orientation-NYC-FirstName-LastName-AgeNN-WOTCN-SSN.pdf
 *   HHA-PCA-Pre-orientation-Upstate-FirstName-LastName-AgeNN-WOTCN-SSN.pdf
 *   Non-standard: LastName_Category.pdf, Full Name_Category.pdf
 */
function parseEmployeeName(filename: string): string {
  const base = filename.replace(/\.pdf$/i, '');

  // Non-standard patterns (e.g., "Pooler_Pre-orientation.pdf", "In-service_Brittany Jones.pdf")
  if (!base.startsWith('HHA-PCA-')) {
    const categories = ['Pre-orientation', 'In-service', 'In-Service', 'Evals', 'Evals & Post Test', 'NHTD', 'HR-Orientation'];
    const underscoreIdx = base.indexOf('_');
    if (underscoreIdx > 0) {
      const left = base.slice(0, underscoreIdx);
      const right = base.slice(underscoreIdx + 1);
      // If left is a category, name is on the right; if right is a category, name is on the left
      if (categories.some((c) => c.toLowerCase() === left.toLowerCase())) {
        return right.replace(/-/g, ' ');
      }
      return left.replace(/-/g, ' ');
    }
    return base.replace(/-/g, ' ');
  }

  // Standard HHA-PCA patterns - remove prefix
  let nameStr = base;

  // Remove the HHA-PCA-Category prefix
  const prefixes = [
    'HHA-PCA-Evals-and-Post-Test-',
    'HHA-PCA-In-service-',
    'HHA-PCA-NHTD-',
    'HHA-PCA-Pre-orientation-NYC-',
    'HHA-PCA-Pre-orientation-Upstate-v2-',
    'HHA-PCA-Pre-orientation-Upstate-',
    'HHA-PCA-HR-Orientation-',
  ];

  for (const prefix of prefixes) {
    if (nameStr.startsWith(prefix)) {
      nameStr = nameStr.slice(prefix.length);
      break;
    }
  }

  // Remove SSN suffix (XXX-XX-XXXX pattern at the end)
  nameStr = nameStr.replace(/-\d{3}-\d{2}-\d{4}$/, '');

  // Remove Age and WOTC suffixes (for Pre-orientation)
  nameStr = nameStr.replace(/-Age\d+-WOTC\d+$/, '');

  // Convert dashes to spaces for the name
  return nameStr.replace(/-/g, ' ');
}

/**
 * Create a human-readable packet name.
 */
function makePacketName(
  date: string,
  category: string,
  employeeName: string
): string {
  return `${category} - ${employeeName} (${date})`;
}

// --- Main Import ---

async function main() {
  console.log('=== AHS Document Import ===');
  console.log(`Source: ${DOCS_DIR}`);
  console.log(`Uploads: ${UPLOADS_DIR}`);
  console.log('');

  // Verify source directory exists
  if (!fs.existsSync(DOCS_DIR)) {
    console.error(`ERROR: Source directory not found: ${DOCS_DIR}`);
    console.error('Please extract the ZIP file first: unzip OneDrive_1_4-1-2026.zip -d /tmp/ahs-docs');
    process.exit(1);
  }

  // Ensure uploads directory exists
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  // Step 1: Create signer users
  console.log('--- Step 1: Creating signer users ---');
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  let usersCreated = 0;

  for (const [key, signer] of Object.entries(SIGNERS)) {
    const existing = await prisma.user.findUnique({ where: { email: signer.email } });
    if (existing) {
      console.log(`  User exists: ${signer.name} (${signer.email})`);
    } else {
      await prisma.user.create({
        data: {
          email: signer.email,
          passwordHash,
          name: signer.name,
          role: 'admin',
          isActive: true,
        },
      });
      console.log(`  Created: ${signer.name} (${signer.email})`);
      usersCreated++;
    }
  }
  console.log(`  ${usersCreated} users created\n`);

  // Step 2: Walk the directory tree and collect all PDFs
  console.log('--- Step 2: Scanning documents ---');
  const pdfFiles: {
    absolutePath: string;
    relativePath: string;
    filename: string;
  }[] = [];

  function walkDir(dir: string, relBase: string = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walkDir(fullPath, relPath);
      } else if (entry.name.toLowerCase().endsWith('.pdf')) {
        pdfFiles.push({
          absolutePath: fullPath,
          relativePath: relPath,
          filename: entry.name,
        });
      }
    }
  }

  walkDir(DOCS_DIR);
  console.log(`  Found ${pdfFiles.length} PDF files\n`);

  // Step 3: Import each PDF
  console.log('--- Step 3: Importing documents ---');
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const batchSize = 50;

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdf = pdfFiles[i];

    try {
      // Parse metadata from path and filename
      const { date, category, signer } = parseFolderPath(pdf.relativePath);
      const employeeName = parseEmployeeName(pdf.filename);
      const packetName = makePacketName(date, category, employeeName);

      // Check if this packet already exists (by name to avoid dupes on re-run)
      const existingPacket = await prisma.signingPacket.findFirst({
        where: { name: packetName },
      });
      if (existingPacket) {
        skipped++;
        continue;
      }

      // Create packet directory and copy PDF
      const packetId = uuidv4();
      const fileId = uuidv4();
      const safeFilename = pdf.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storedFilename = `${fileId}_${safeFilename}`;
      const packetDir = path.join(UPLOADS_DIR, packetId);
      fs.mkdirSync(packetDir, { recursive: true });
      fs.copyFileSync(pdf.absolutePath, path.join(packetDir, storedFilename));

      // Extract placeholders from PDF
      let placeholders: any[] = [];
      try {
        placeholders = await parseTemplatePlaceholders(pdf.absolutePath);
      } catch (e) {
        // PDF might not have any placeholders - that's OK
        console.warn(`  Warning: Could not extract placeholders from ${pdf.filename}`);
      }

      // Create the signing packet
      const packet = await prisma.signingPacket.create({
        data: {
          id: packetId,
          name: packetName,
          fileName: pdf.filename,
          filePath: `packets/${packetId}/${storedFilename}`,
          placeholders: JSON.stringify(placeholders),
          status: signer ? 'draft' : 'pending_assignment',
          employeeName: employeeName,
        },
      });

      // If we know the signer, create a recipient
      if (signer) {
        const signerInfo = Object.entries(SIGNERS).find(
          ([key]) => key.toLowerCase() === signer.toLowerCase()
        );

        if (signerInfo) {
          const [, signerData] = signerInfo;
          const token = generateSecureToken();
          const tokenExpiresAt = getTokenExpiryDate();

          // Determine the role to assign based on placeholders
          // The PDFs use "signer1" role for signatures
          let signerRole = 'signer1';
          if (placeholders.length > 0) {
            const sigRoles = placeholders
              .filter((p: any) => p.type === 'SIGNATURE')
              .map((p: any) => p.role);
            if (sigRoles.length > 0) {
              signerRole = sigRoles[0]; // Use the first signature role found
            }
          }

          await prisma.recipient.create({
            data: {
              packetId: packet.id,
              roleName: signerRole,
              name: signerData.name,
              email: signerData.email,
              order: 1,
              token,
              tokenExpiresAt,
              status: 'pending',
            },
          });
        }
      }

      // Audit log
      await prisma.auditLog.create({
        data: {
          packetId: packet.id,
          action: 'imported',
          details: `Imported from ${pdf.relativePath}${signer ? ` (assigned to ${signer})` : ' (unassigned)'}`,
        },
      });

      imported++;

      // Progress indicator
      if (imported % batchSize === 0) {
        console.log(`  Progress: ${imported}/${pdfFiles.length} imported...`);
      }
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR importing ${pdf.filename}: ${msg}`);
    }
  }

  console.log('');
  console.log('=== Import Complete ===');
  console.log(`  Imported: ${imported}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total PDFs: ${pdfFiles.length}`);
  console.log('');

  // Summary by category
  const statsByStatus = await prisma.signingPacket.groupBy({
    by: ['status'],
    _count: true,
  });
  console.log('--- Packets by status ---');
  for (const s of statsByStatus) {
    console.log(`  ${s.status}: ${s._count}`);
  }

  const totalRecipients = await prisma.recipient.count();
  console.log(`\n  Total recipients created: ${totalRecipients}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
