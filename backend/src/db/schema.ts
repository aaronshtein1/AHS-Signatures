import { pgTable, text, boolean, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ─── Users ───────────────────────────────────────────────────────
export const users = pgTable('User', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').unique().notNull(),
  passwordHash: text('passwordHash').notNull(),
  name: text('name').notNull(),
  role: text('role').default('user').notNull(),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  lastLoginAt: timestamp('lastLoginAt', { precision: 3, mode: 'date' }),
}, (table) => [
  index('User_email_idx').on(table.email),
]);

// ─── Signing Packets ─────────────────────────────────────────────
export const signingPackets = pgTable('SigningPacket', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  fileName: text('fileName').notNull(),
  filePath: text('filePath').notNull(),
  placeholders: text('placeholders').notNull(),
  status: text('status').default('draft').notNull(),
  signedPdfPath: text('signedPdfPath'),
  signedPdfHash: text('signedPdfHash'),
  sharepointUrl: text('sharepointUrl'),
  sharepointFolder: text('sharepointFolder'),
  sharepointError: text('sharepointError'),
  employeeName: text('employeeName'),
  employeeEmail: text('employeeEmail'),
  formRouteId: text('formRouteId'),
  county: text('county'),
  createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  completedAt: timestamp('completedAt', { precision: 3, mode: 'date' }),
});

export const signingPacketRelations = relations(signingPackets, ({ many }) => ({
  recipients: many(recipients),
  auditLogs: many(auditLogs),
}));

// ─── Recipients ──────────────────────────────────────────────────
export const recipients = pgTable('Recipient', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  packetId: text('packetId').notNull(),
  roleName: text('roleName').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  order: integer('order').notNull(),
  status: text('status').default('pending').notNull(),
  token: text('token').unique().notNull(),
  tokenExpiresAt: timestamp('tokenExpiresAt', { precision: 3, mode: 'date' }).notNull(),
  signedAt: timestamp('signedAt', { precision: 3, mode: 'date' }),
}, (table) => [
  index('Recipient_token_idx').on(table.token),
]);

export const recipientRelations = relations(recipients, ({ one, many }) => ({
  packet: one(signingPackets, {
    fields: [recipients.packetId],
    references: [signingPackets.id],
  }),
  signature: one(signatures),
  auditLogs: many(auditLogs),
}));

// ─── Signatures ──────────────────────────────────────────────────
export const signatures = pgTable('Signature', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  recipientId: text('recipientId').unique().notNull(),
  signatureData: text('signatureData').notNull(),
  signatureType: text('signatureType').notNull(),
  typedName: text('typedName'),
  textFields: text('textFields'),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  attestationText: text('attestationText'),
  identityRecord: text('identityRecord'),
  createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).defaultNow().notNull(),
});

export const signatureRelations = relations(signatures, ({ one }) => ({
  recipient: one(recipients, {
    fields: [signatures.recipientId],
    references: [recipients.id],
  }),
}));

// ─── Form Routes ─────────────────────────────────────────────────
export const formRoutes = pgTable('FormRoute', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  jotformFormId: text('jotformFormId').unique().notNull(),
  formName: text('formName').notNull(),
  signerEmail: text('signerEmail'),
  signerName: text('signerName'),
  signerRole: text('signerRole').default('countersigner').notNull(),
  driveFolderId: text('driveFolderId'),
  sharepointFolder: text('sharepointFolder'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

// ─── Processed Submissions ───────────────────────────────────────
export const processedSubmissions = pgTable('ProcessedSubmission', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  submissionId: text('submissionId').unique().notNull(),
  formId: text('formId').notNull(),
  packetId: text('packetId'),
  driveFileId: text('driveFileId'),
  processedAt: timestamp('processedAt', { precision: 3, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('ProcessedSubmission_formId_idx').on(table.formId),
  index('ProcessedSubmission_driveFileId_idx').on(table.driveFileId),
]);

// ─── System Settings ─────────────────────────────────────────────
export const systemSettings = pgTable('SystemSetting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

// ─── SharePoint Folder Cache ─────────────────────────────────────
export const sharePointFolderCaches = pgTable('SharePointFolderCache', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  folderId: text('folderId').notNull(),
  name: text('name').notNull(),
  webUrl: text('webUrl').default('').notNull(),
  childCount: integer('childCount').default(0).notNull(),
  path: text('path').notNull(),
  parentFolder: text('parentFolder').default('').notNull(),
  cacheKey: text('cacheKey').notNull(),
  cachedAt: timestamp('cachedAt', { precision: 3, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('SharePointFolderCache_cacheKey_idx').on(table.cacheKey),
  index('SharePointFolderCache_name_idx').on(table.name),
]);

// ─── Audit Logs ──────────────────────────────────────────────────
export const auditLogs = pgTable('AuditLog', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  packetId: text('packetId').notNull(),
  recipientId: text('recipientId'),
  action: text('action').notNull(),
  details: text('details'),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).defaultNow().notNull(),
});

export const auditLogRelations = relations(auditLogs, ({ one }) => ({
  packet: one(signingPackets, {
    fields: [auditLogs.packetId],
    references: [signingPackets.id],
  }),
  recipient: one(recipients, {
    fields: [auditLogs.recipientId],
    references: [recipients.id],
  }),
}));
