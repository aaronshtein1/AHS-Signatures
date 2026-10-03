/**
 * Idempotent PostgreSQL schema setup, matching src/db/schema.ts.
 *
 * Safe to run on every deploy, against an empty database or one created earlier
 * (by Prisma, drizzle-kit push or a previous run): tables, columns, defaults and
 * indexes are only added when missing; nothing is dropped or rewritten.
 *
 * Usage: npm run db:migrate   (compiled: node dist/db/migrate.js)
 */
import { Pool } from 'pg';
import { config } from '../utils/config.js';

type Column = [name: string, definition: string];

interface Table {
  name: string;
  columns: Column[];
  indexes?: Array<[name: string, definition: string]>;
}

const TS = 'TIMESTAMP(3)';

const TABLES: Table[] = [
  {
    name: 'User',
    columns: [
      ['id', 'TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text'],
      ['email', 'TEXT NOT NULL'],
      ['passwordHash', 'TEXT NOT NULL'],
      ['name', 'TEXT NOT NULL'],
      ['role', "TEXT NOT NULL DEFAULT 'user'"],
      ['isActive', 'BOOLEAN NOT NULL DEFAULT true'],
      ['createdAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
      ['updatedAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
      ['lastLoginAt', TS],
    ],
    indexes: [
      ['User_email_key', 'CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")'],
      ['User_email_idx', 'CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email")'],
    ],
  },
  {
    name: 'SigningPacket',
    columns: [
      ['id', 'TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text'],
      ['name', 'TEXT NOT NULL'],
      ['fileName', 'TEXT NOT NULL'],
      ['filePath', 'TEXT NOT NULL'],
      ['placeholders', 'TEXT NOT NULL'],
      ['status', "TEXT NOT NULL DEFAULT 'draft'"],
      ['signedPdfPath', 'TEXT'],
      ['signedPdfHash', 'TEXT'],
      ['sharepointUrl', 'TEXT'],
      ['sharepointFolder', 'TEXT'],
      ['sharepointError', 'TEXT'],
      ['employeeName', 'TEXT'],
      ['employeeEmail', 'TEXT'],
      ['formRouteId', 'TEXT'],
      ['county', 'TEXT'],
      ['createdAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
      ['updatedAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
      ['completedAt', TS],
    ],
  },
  {
    name: 'Recipient',
    columns: [
      ['id', 'TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text'],
      ['packetId', 'TEXT NOT NULL'],
      ['roleName', 'TEXT NOT NULL'],
      ['name', 'TEXT NOT NULL'],
      ['email', 'TEXT NOT NULL'],
      ['order', 'INTEGER NOT NULL'],
      ['status', "TEXT NOT NULL DEFAULT 'pending'"],
      ['token', 'TEXT NOT NULL'],
      ['tokenExpiresAt', `${TS} NOT NULL`],
      ['signedAt', TS],
    ],
    indexes: [
      ['Recipient_token_key', 'CREATE UNIQUE INDEX IF NOT EXISTS "Recipient_token_key" ON "Recipient"("token")'],
      ['Recipient_token_idx', 'CREATE INDEX IF NOT EXISTS "Recipient_token_idx" ON "Recipient"("token")'],
      ['Recipient_packetId_idx', 'CREATE INDEX IF NOT EXISTS "Recipient_packetId_idx" ON "Recipient"("packetId")'],
    ],
  },
  {
    name: 'Signature',
    columns: [
      ['id', 'TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text'],
      ['recipientId', 'TEXT NOT NULL'],
      ['signatureData', 'TEXT NOT NULL'],
      ['signatureType', 'TEXT NOT NULL'],
      ['typedName', 'TEXT'],
      ['textFields', 'TEXT'],
      ['ipAddress', 'TEXT'],
      ['userAgent', 'TEXT'],
      ['attestationText', 'TEXT'],
      ['identityRecord', 'TEXT'],
      ['createdAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
    ],
    indexes: [
      ['Signature_recipientId_key', 'CREATE UNIQUE INDEX IF NOT EXISTS "Signature_recipientId_key" ON "Signature"("recipientId")'],
    ],
  },
  {
    name: 'FormRoute',
    columns: [
      ['id', 'TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text'],
      ['jotformFormId', 'TEXT NOT NULL'],
      ['formName', 'TEXT NOT NULL'],
      ['signerEmail', 'TEXT'],
      ['signerName', 'TEXT'],
      ['signerRole', "TEXT NOT NULL DEFAULT 'countersigner'"],
      ['driveFolderId', 'TEXT'],
      ['sharepointFolder', 'TEXT'],
      ['isActive', 'BOOLEAN NOT NULL DEFAULT true'],
      ['createdAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
      ['updatedAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
    ],
    indexes: [
      ['FormRoute_jotformFormId_key', 'CREATE UNIQUE INDEX IF NOT EXISTS "FormRoute_jotformFormId_key" ON "FormRoute"("jotformFormId")'],
    ],
  },
  {
    name: 'ProcessedSubmission',
    columns: [
      ['id', 'TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text'],
      ['submissionId', 'TEXT NOT NULL'],
      ['formId', 'TEXT NOT NULL'],
      ['packetId', 'TEXT'],
      ['driveFileId', 'TEXT'],
      ['processedAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
    ],
    indexes: [
      ['ProcessedSubmission_submissionId_key', 'CREATE UNIQUE INDEX IF NOT EXISTS "ProcessedSubmission_submissionId_key" ON "ProcessedSubmission"("submissionId")'],
      ['ProcessedSubmission_formId_idx', 'CREATE INDEX IF NOT EXISTS "ProcessedSubmission_formId_idx" ON "ProcessedSubmission"("formId")'],
      ['ProcessedSubmission_driveFileId_idx', 'CREATE INDEX IF NOT EXISTS "ProcessedSubmission_driveFileId_idx" ON "ProcessedSubmission"("driveFileId")'],
    ],
  },
  {
    name: 'SystemSetting',
    columns: [
      ['key', 'TEXT PRIMARY KEY'],
      ['value', 'TEXT NOT NULL'],
      ['updatedAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
    ],
  },
  {
    name: 'SharePointFolderCache',
    columns: [
      ['id', 'TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text'],
      ['folderId', 'TEXT NOT NULL'],
      ['name', 'TEXT NOT NULL'],
      ['webUrl', "TEXT NOT NULL DEFAULT ''"],
      ['childCount', 'INTEGER NOT NULL DEFAULT 0'],
      ['path', 'TEXT NOT NULL'],
      ['parentFolder', "TEXT NOT NULL DEFAULT ''"],
      ['cacheKey', 'TEXT NOT NULL'],
      ['cachedAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
    ],
    indexes: [
      ['SharePointFolderCache_cacheKey_idx', 'CREATE INDEX IF NOT EXISTS "SharePointFolderCache_cacheKey_idx" ON "SharePointFolderCache"("cacheKey")'],
      ['SharePointFolderCache_name_idx', 'CREATE INDEX IF NOT EXISTS "SharePointFolderCache_name_idx" ON "SharePointFolderCache"("name")'],
    ],
  },
  {
    name: 'AuditLog',
    columns: [
      ['id', 'TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text'],
      ['packetId', 'TEXT NOT NULL'],
      ['recipientId', 'TEXT'],
      ['action', 'TEXT NOT NULL'],
      ['details', 'TEXT'],
      ['ipAddress', 'TEXT'],
      ['userAgent', 'TEXT'],
      ['createdAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
    ],
    indexes: [
      ['AuditLog_packetId_idx', 'CREATE INDEX IF NOT EXISTS "AuditLog_packetId_idx" ON "AuditLog"("packetId")'],
    ],
  },
];

TABLES.push({
  name: 'StoredFile',
  columns: [
    ['key', 'TEXT PRIMARY KEY'],
    ['data', 'BYTEA NOT NULL'],
    ['contentType', "TEXT NOT NULL DEFAULT 'application/pdf'"],
    ['size', 'INTEGER NOT NULL DEFAULT 0'],
    ['createdAt', `${TS} NOT NULL DEFAULT CURRENT_TIMESTAMP`],
  ],
});

const FOREIGN_KEYS: Array<{ name: string; table: string; sql: string }> = [
  {
    name: 'Recipient_packetId_fkey', table: 'Recipient',
    sql: 'FOREIGN KEY ("packetId") REFERENCES "SigningPacket"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  },
  {
    name: 'Signature_recipientId_fkey', table: 'Signature',
    sql: 'FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  },
  {
    name: 'AuditLog_packetId_fkey', table: 'AuditLog',
    sql: 'FOREIGN KEY ("packetId") REFERENCES "SigningPacket"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  },
  {
    name: 'AuditLog_recipientId_fkey', table: 'AuditLog',
    sql: 'FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  },
];

/** Column definition for ADD COLUMN on an existing table (no PRIMARY KEY). */
function addColumnDefinition(def: string): string {
  return def.replace(/\s*PRIMARY KEY/i, '');
}

function defaultClause(def: string): string | null {
  const m = def.match(/DEFAULT\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function migrate(databaseUrl = config.DATABASE_URL): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    // Serialize concurrent deploys / replicas
    await client.query('SELECT pg_advisory_lock(727274)');

    for (const table of TABLES) {
      const cols = table.columns.map(([n, d]) => `"${n}" ${d}`).join(',\n  ');
      await client.query(`CREATE TABLE IF NOT EXISTS "${table.name}" (\n  ${cols}\n)`);

      const existing = await client.query<{ column_name: string; column_default: string | null }>(
        `SELECT column_name, column_default FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1`,
        [table.name]
      );
      const present = new Map(existing.rows.map(r => [r.column_name, r.column_default]));

      for (const [col, def] of table.columns) {
        if (!present.has(col)) {
          // A NOT NULL column without a default cannot be added to a table with rows
          const safeDef = /NOT NULL/i.test(def) && !defaultClause(def)
            ? addColumnDefinition(def).replace(/\s*NOT NULL/i, '')
            : addColumnDefinition(def);
          await client.query(`ALTER TABLE "${table.name}" ADD COLUMN "${col}" ${safeDef}`);
          console.log(`[migrate] Added column ${table.name}.${col}`);
        } else if (present.get(col) === null && defaultClause(def)) {
          // e.g. tables created by Prisma have no DB-side id / updatedAt defaults
          await client.query(`ALTER TABLE "${table.name}" ALTER COLUMN "${col}" SET DEFAULT ${defaultClause(def)}`);
        }
      }

      for (const [, sql] of table.indexes || []) {
        try {
          await client.query(sql);
        } catch (err) {
          console.warn(`[migrate] Could not create index on ${table.name}: ${(err as Error).message}`);
        }
      }
    }

    for (const fk of FOREIGN_KEYS) {
      const exists = await client.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1`, [fk.name]
      );
      if (exists.rowCount) continue;
      try {
        await client.query(`ALTER TABLE "${fk.table}" ADD CONSTRAINT "${fk.name}" ${fk.sql}`);
      } catch (err) {
        // Existing orphaned rows would block the constraint; the app works without it.
        console.warn(`[migrate] Skipped foreign key ${fk.name}: ${(err as Error).message}`);
      }
    }

    console.log('[migrate] Database schema is up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error('[migrate] Failed:', err);
    process.exit(1);
  });
}
