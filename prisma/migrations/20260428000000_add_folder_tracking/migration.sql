-- CreateEnum
CREATE TYPE "SystemFolderKind" AS ENUM ('INBOX', 'SENT_ITEMS', 'DRAFTS', 'JUNK_EMAIL', 'DELETED_ITEMS');

-- CreateEnum
CREATE TYPE "RuleScopeKind" AS ENUM ('ORGANIZATION', 'ACCOUNT', 'FOLDER');

-- AlterTable: EmailAccount
ALTER TABLE "EmailAccount" ADD COLUMN "foldersDeltaLink" TEXT;

-- AlterTable: Thread
ALTER TABLE "Thread" ADD COLUMN "folderIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable: Message
ALTER TABLE "Message" ADD COLUMN "folderId" TEXT;
ALTER TABLE "Message" ADD COLUMN "isTracked" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: MonitoringRule
ALTER TABLE "MonitoringRule" ADD COLUMN "scopeKind" "RuleScopeKind" NOT NULL DEFAULT 'ORGANIZATION';
ALTER TABLE "MonitoringRule" ADD COLUMN "emailAccountId" TEXT;
ALTER TABLE "MonitoringRule" ADD COLUMN "folderId" TEXT;

-- CreateTable: EmailFolder
CREATE TABLE "EmailFolder" (
    "id" TEXT NOT NULL,
    "emailAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "systemKind" "SystemFolderKind",
    "monitored" BOOLEAN,
    "isNew" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailFolder_emailAccountId_externalId_key" ON "EmailFolder"("emailAccountId", "externalId");
CREATE INDEX "EmailFolder_emailAccountId_parentId_idx" ON "EmailFolder"("emailAccountId", "parentId");
CREATE INDEX "EmailFolder_emailAccountId_path_idx" ON "EmailFolder"("emailAccountId", "path");

-- CreateIndex on Message
CREATE INDEX "Message_folderId_idx" ON "Message"("folderId");
CREATE INDEX "Message_isTracked_idx" ON "Message"("isTracked");

-- CreateIndex on Thread (GIN for folderIds array)
CREATE INDEX "Thread_folderIds_idx" ON "Thread" USING GIN ("folderIds");

-- CreateIndex on MonitoringRule
CREATE INDEX "MonitoringRule_organizationId_evaluationType_scopeKind_idx" ON "MonitoringRule"("organizationId", "evaluationType", "scopeKind");

-- AddForeignKey: EmailFolder -> EmailAccount
ALTER TABLE "EmailFolder" ADD CONSTRAINT "EmailFolder_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: EmailFolder -> EmailFolder (parent)
ALTER TABLE "EmailFolder" ADD CONSTRAINT "EmailFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "EmailFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Message -> EmailFolder
ALTER TABLE "Message" ADD CONSTRAINT "Message_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "EmailFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: MonitoringRule -> EmailAccount
ALTER TABLE "MonitoringRule" ADD CONSTRAINT "MonitoringRule_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: MonitoringRule -> EmailFolder
ALTER TABLE "MonitoringRule" ADD CONSTRAINT "MonitoringRule_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "EmailFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce rule scope shape
ALTER TABLE "MonitoringRule" ADD CONSTRAINT "MonitoringRule_scope_shape_check"
CHECK (
  ("scopeKind" = 'ORGANIZATION' AND "emailAccountId" IS NULL AND "folderId" IS NULL)
  OR ("scopeKind" = 'ACCOUNT' AND "emailAccountId" IS NOT NULL AND "folderId" IS NULL)
  OR ("scopeKind" = 'FOLDER' AND "emailAccountId" IS NOT NULL AND "folderId" IS NOT NULL)
);
