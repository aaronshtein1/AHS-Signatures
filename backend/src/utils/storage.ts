import fs from 'fs/promises';
import path from 'path';
import { db, storedFiles, eq } from '../db/index.js';

/**
 * Document storage in PostgreSQL (table "StoredFile"), so originals and signed
 * PDFs live in the same Railway database as everything else and survive
 * redeploys. Keys look like "packets/<id>/<file>.pdf" or "signed/<file>.pdf".
 */

// Files written by older versions to the container disk (read-only fallback)
const LEGACY_ROOT = path.join(process.cwd(), 'uploads');

export async function uploadFile(key: string, buffer: Buffer | Uint8Array, contentType = 'application/pdf'): Promise<void> {
  const data = Buffer.from(buffer);
  await db.insert(storedFiles)
    .values({ key, data, contentType, size: data.length })
    .onConflictDoUpdate({
      target: storedFiles.key,
      set: { data, contentType, size: data.length, createdAt: new Date() },
    });
}

export async function downloadFile(key: string): Promise<Buffer> {
  const row = await db.query.storedFiles.findFirst({ where: eq(storedFiles.key, key) });
  if (row) return row.data;

  // Older deployments kept files on disk; move them into the database on first read
  const legacyPath = path.join(LEGACY_ROOT, key);
  if (!path.resolve(legacyPath).startsWith(path.resolve(LEGACY_ROOT) + path.sep)) {
    throw new Error(`File not found: ${key}`);
  }
  try {
    const data = await fs.readFile(legacyPath);
    await uploadFile(key, data).catch(err => console.error(`[Storage] Could not import ${key}:`, err));
    return data;
  } catch {
    throw new Error(`File not found: ${key}`);
  }
}

export async function deleteFile(key: string): Promise<void> {
  await db.delete(storedFiles).where(eq(storedFiles.key, key));
  await fs.unlink(path.join(LEGACY_ROOT, key)).catch(() => {});
}
