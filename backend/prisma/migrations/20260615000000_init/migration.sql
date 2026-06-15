-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME
);

-- CreateTable
CREATE TABLE "SigningPacket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "placeholders" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "signedPdfPath" TEXT,
    "sharepointUrl" TEXT,
    "sharepointFolder" TEXT,
    "sharepointError" TEXT,
    "employeeName" TEXT,
    "employeeEmail" TEXT,
    "formRouteId" TEXT,
    "county" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packetId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "token" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME NOT NULL,
    "signedAt" DATETIME,
    CONSTRAINT "Recipient_packetId_fkey" FOREIGN KEY ("packetId") REFERENCES "SigningPacket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientId" TEXT NOT NULL,
    "signatureData" TEXT NOT NULL,
    "signatureType" TEXT NOT NULL,
    "typedName" TEXT,
    "textFields" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "attestationText" TEXT,
    "identityRecord" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Signature_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FormRoute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jotformFormId" TEXT NOT NULL,
    "formName" TEXT NOT NULL,
    "signerEmail" TEXT,
    "signerName" TEXT,
    "signerRole" TEXT NOT NULL DEFAULT 'countersigner',
    "driveFolderId" TEXT,
    "sharepointFolder" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProcessedSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "packetId" TEXT,
    "driveFileId" TEXT,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SharePointFolderCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webUrl" TEXT NOT NULL DEFAULT '',
    "childCount" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "parentFolder" TEXT NOT NULL DEFAULT '',
    "cacheKey" TEXT NOT NULL,
    "cachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packetId" TEXT NOT NULL,
    "recipientId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_packetId_fkey" FOREIGN KEY ("packetId") REFERENCES "SigningPacket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_token_key" ON "Recipient"("token");
CREATE INDEX "Recipient_token_idx" ON "Recipient"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Signature_recipientId_key" ON "Signature"("recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "FormRoute_jotformFormId_key" ON "FormRoute"("jotformFormId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedSubmission_submissionId_key" ON "ProcessedSubmission"("submissionId");
CREATE INDEX "ProcessedSubmission_formId_idx" ON "ProcessedSubmission"("formId");
CREATE INDEX "ProcessedSubmission_driveFileId_idx" ON "ProcessedSubmission"("driveFileId");

-- CreateIndex
CREATE INDEX "SharePointFolderCache_cacheKey_idx" ON "SharePointFolderCache"("cacheKey");
CREATE INDEX "SharePointFolderCache_name_idx" ON "SharePointFolderCache"("name");
