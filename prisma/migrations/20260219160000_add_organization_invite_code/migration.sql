-- AlterTable: add inviteCode as nullable first
ALTER TABLE "Organization" ADD COLUMN "inviteCode" TEXT;

-- Backfill existing rows with unique UUIDs
UPDATE "Organization" SET "inviteCode" = gen_random_uuid() WHERE "inviteCode" IS NULL;

-- Make the column required
ALTER TABLE "Organization" ALTER COLUMN "inviteCode" SET NOT NULL;

-- Add unique constraint
CREATE UNIQUE INDEX "Organization_inviteCode_key" ON "Organization"("inviteCode");
