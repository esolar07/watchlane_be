-- Denormalize organizationId onto EmailFolder, Message, Evaluation, Alert.
-- Strategy: add nullable column → backfill from parent → assert no NULLs →
-- promote to NOT NULL → add FK + indexes. All inside one implicit transaction
-- so partial failure leaves the schema unchanged.

-- ============================================
-- Phase 1: Add nullable organizationId columns
-- ============================================

ALTER TABLE "EmailFolder" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Message"     ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Evaluation"  ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Alert"       ADD COLUMN "organizationId" TEXT;

-- ============================================
-- Phase 2: Backfill from parent records
-- ============================================

-- EmailFolder ← EmailAccount.organizationId
UPDATE "EmailFolder" f
SET "organizationId" = ea."organizationId"
FROM "EmailAccount" ea
WHERE ea."id" = f."emailAccountId";

-- Message ← Thread.organizationId
UPDATE "Message" m
SET "organizationId" = t."organizationId"
FROM "Thread" t
WHERE t."id" = m."threadId";

-- Evaluation ← Thread.organizationId
UPDATE "Evaluation" e
SET "organizationId" = t."organizationId"
FROM "Thread" t
WHERE t."id" = e."threadId";

-- Alert ← Thread.organizationId
UPDATE "Alert" a
SET "organizationId" = t."organizationId"
FROM "Thread" t
WHERE t."id" = a."threadId";

-- ============================================
-- Phase 3: Assert backfill is complete
-- (Aborts the migration if any row is still NULL.)
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "EmailFolder" WHERE "organizationId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: EmailFolder rows have NULL organizationId';
  END IF;
  IF EXISTS (SELECT 1 FROM "Message" WHERE "organizationId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: Message rows have NULL organizationId';
  END IF;
  IF EXISTS (SELECT 1 FROM "Evaluation" WHERE "organizationId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: Evaluation rows have NULL organizationId';
  END IF;
  IF EXISTS (SELECT 1 FROM "Alert" WHERE "organizationId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: Alert rows have NULL organizationId';
  END IF;
END$$;

-- ============================================
-- Phase 4: Promote to NOT NULL
-- ============================================

ALTER TABLE "EmailFolder" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Message"     ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Evaluation"  ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Alert"       ALTER COLUMN "organizationId" SET NOT NULL;

-- ============================================
-- Phase 5: Foreign keys
-- ============================================

ALTER TABLE "EmailFolder"
  ADD CONSTRAINT "EmailFolder_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Message"
  ADD CONSTRAINT "Message_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Evaluation"
  ADD CONSTRAINT "Evaluation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Alert"
  ADD CONSTRAINT "Alert_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================
-- Phase 6: Indexes
-- ============================================

CREATE INDEX "EmailFolder_organizationId_idx" ON "EmailFolder"("organizationId");
CREATE INDEX "Message_organizationId_idx"     ON "Message"("organizationId");
CREATE INDEX "Message_organizationId_sentAt_idx" ON "Message"("organizationId", "sentAt");
CREATE INDEX "Evaluation_organizationId_idx"  ON "Evaluation"("organizationId");
CREATE INDEX "Alert_organizationId_idx"       ON "Alert"("organizationId");
