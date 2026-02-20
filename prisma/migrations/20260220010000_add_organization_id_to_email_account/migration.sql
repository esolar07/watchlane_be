-- Drop the old unique constraint
DROP INDEX "EmailAccount_provider_emailAddress_key";

-- Add organizationId as nullable first
ALTER TABLE "EmailAccount" ADD COLUMN "organizationId" TEXT;

-- Backfill: assign each email account to the first org its user belongs to
UPDATE "EmailAccount" ea
SET "organizationId" = (
  SELECT om."organizationId"
  FROM "OrganizationMember" om
  WHERE om."userId" = ea."userId"
  LIMIT 1
)
WHERE ea."organizationId" IS NULL;

-- Delete any orphaned email accounts that have no org membership
DELETE FROM "EmailAccount" WHERE "organizationId" IS NULL;

-- Make the column required
ALTER TABLE "EmailAccount" ALTER COLUMN "organizationId" SET NOT NULL;

-- Add foreign key
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add the new unique constraint (per org)
CREATE UNIQUE INDEX "EmailAccount_provider_emailAddress_organizationId_key" ON "EmailAccount"("provider", "emailAddress", "organizationId");
