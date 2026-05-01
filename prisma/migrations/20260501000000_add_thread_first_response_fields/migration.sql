-- AlterTable: add first-response fields to Thread
ALTER TABLE "Thread" ADD COLUMN "firstResponseMinutes" INTEGER;
ALTER TABLE "Thread" ADD COLUMN "hadLateFirstResponse" BOOLEAN NOT NULL DEFAULT false;

-- Backfill firstResponseMinutes from existing data
UPDATE "Thread"
SET "firstResponseMinutes" = ROUND(EXTRACT(EPOCH FROM ("firstOutboundAt" - "firstInboundAt")) / 60)::INTEGER
WHERE "firstInboundAt" IS NOT NULL AND "firstOutboundAt" IS NOT NULL;

-- Backfill hadLateFirstResponse using each org's current SLA setting (defaults to 560 if no settings row)
UPDATE "Thread" t
SET "hadLateFirstResponse" = (t."firstResponseMinutes" > COALESCE(os."slaMinutes", 560))
FROM "OrganizationSettings" os
WHERE os."organizationId" = t."organizationId"
  AND t."firstResponseMinutes" IS NOT NULL;

-- Threads in orgs without OrganizationSettings: use the 560 default
UPDATE "Thread" t
SET "hadLateFirstResponse" = (t."firstResponseMinutes" > 560)
WHERE t."firstResponseMinutes" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "OrganizationSettings" os WHERE os."organizationId" = t."organizationId");

-- Index for "show me late responses" queries
CREATE INDEX "Thread_organizationId_hadLateFirstResponse_idx" ON "Thread"("organizationId", "hadLateFirstResponse");
