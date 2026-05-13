-- Phase 2: rename Organization -> Team across schema. Forward-only, mechanical.

ALTER TABLE "Organization"         RENAME TO "Team";
ALTER TABLE "OrganizationMember"   RENAME TO "TeamMember";
ALTER TABLE "OrganizationSettings" RENAME TO "TeamSettings";

ALTER TABLE "EmailAccount"    RENAME COLUMN "organizationId" TO "teamId";
ALTER TABLE "EmailFolder"     RENAME COLUMN "organizationId" TO "teamId";
ALTER TABLE "Thread"          RENAME COLUMN "organizationId" TO "teamId";
ALTER TABLE "Message"         RENAME COLUMN "organizationId" TO "teamId";
ALTER TABLE "Evaluation"      RENAME COLUMN "organizationId" TO "teamId";
ALTER TABLE "Alert"           RENAME COLUMN "organizationId" TO "teamId";
ALTER TABLE "MonitoringRule"  RENAME COLUMN "organizationId" TO "teamId";
ALTER TABLE "TeamMember"      RENAME COLUMN "organizationId" TO "teamId";
ALTER TABLE "TeamSettings"    RENAME COLUMN "organizationId" TO "teamId";
ALTER TABLE "AuditLog"        RENAME COLUMN "organizationId" TO "teamId";
ALTER TABLE "UsageRecord"     RENAME COLUMN "organizationId" TO "teamId";

ALTER INDEX IF EXISTS "Organization_workspaceId_idx"    RENAME TO "Team_workspaceId_idx";
ALTER INDEX IF EXISTS "Organization_inviteCode_key"     RENAME TO "Team_inviteCode_key";
ALTER INDEX IF EXISTS "Organization_pkey"               RENAME TO "Team_pkey";
ALTER INDEX IF EXISTS "OrganizationMember_pkey"         RENAME TO "TeamMember_pkey";
ALTER INDEX IF EXISTS "OrganizationMember_userId_organizationId_key" RENAME TO "TeamMember_userId_teamId_key";
ALTER INDEX IF EXISTS "OrganizationSettings_pkey"       RENAME TO "TeamSettings_pkey";
ALTER INDEX IF EXISTS "OrganizationSettings_organizationId_key" RENAME TO "TeamSettings_teamId_key";

ALTER INDEX IF EXISTS "EmailAccount_provider_emailAddress_organizationId_key" RENAME TO "EmailAccount_provider_emailAddress_teamId_key";
ALTER INDEX IF EXISTS "EmailFolder_organizationId_idx"   RENAME TO "EmailFolder_teamId_idx";
ALTER INDEX IF EXISTS "Thread_organizationId_idx"        RENAME TO "Thread_teamId_idx";
ALTER INDEX IF EXISTS "Message_organizationId_idx"       RENAME TO "Message_teamId_idx";
ALTER INDEX IF EXISTS "Message_organizationId_sentAt_idx" RENAME TO "Message_teamId_sentAt_idx";
ALTER INDEX IF EXISTS "Evaluation_organizationId_idx"    RENAME TO "Evaluation_teamId_idx";
ALTER INDEX IF EXISTS "Alert_organizationId_idx"         RENAME TO "Alert_teamId_idx";
ALTER INDEX IF EXISTS "MonitoringRule_organizationId_idx" RENAME TO "MonitoringRule_teamId_idx";
ALTER INDEX IF EXISTS "MonitoringRule_organizationId_evaluationType_scopeKind_idx" RENAME TO "MonitoringRule_teamId_evaluationType_scopeKind_idx";
ALTER INDEX IF EXISTS "AuditLog_organizationId_idx"      RENAME TO "AuditLog_teamId_idx";
ALTER INDEX IF EXISTS "UsageRecord_organizationId_idx"   RENAME TO "UsageRecord_teamId_idx";

ALTER TABLE "TeamSettings"   DROP CONSTRAINT IF EXISTS "OrganizationSettings_organizationId_fkey";
ALTER TABLE "TeamMember"     DROP CONSTRAINT IF EXISTS "OrganizationMember_organizationId_fkey";
ALTER TABLE "TeamMember"     DROP CONSTRAINT IF EXISTS "OrganizationMember_userId_fkey";
ALTER TABLE "EmailAccount"   DROP CONSTRAINT IF EXISTS "EmailAccount_organizationId_fkey";
ALTER TABLE "EmailFolder"    DROP CONSTRAINT IF EXISTS "EmailFolder_organizationId_fkey";
ALTER TABLE "Thread"         DROP CONSTRAINT IF EXISTS "Thread_organizationId_fkey";
ALTER TABLE "Message"        DROP CONSTRAINT IF EXISTS "Message_organizationId_fkey";
ALTER TABLE "Evaluation"     DROP CONSTRAINT IF EXISTS "Evaluation_organizationId_fkey";
ALTER TABLE "Alert"          DROP CONSTRAINT IF EXISTS "Alert_organizationId_fkey";
ALTER TABLE "MonitoringRule" DROP CONSTRAINT IF EXISTS "MonitoringRule_organizationId_fkey";
ALTER TABLE "Team"           DROP CONSTRAINT IF EXISTS "Organization_workspaceId_fkey";

ALTER TABLE "TeamSettings"   ADD CONSTRAINT "TeamSettings_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "TeamMember"     ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "TeamMember"     ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "EmailAccount"   ADD CONSTRAINT "EmailAccount_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "EmailFolder"    ADD CONSTRAINT "EmailFolder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Thread"         ADD CONSTRAINT "Thread_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Message"        ADD CONSTRAINT "Message_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Evaluation"     ADD CONSTRAINT "Evaluation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Alert"          ADD CONSTRAINT "Alert_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "MonitoringRule" ADD CONSTRAINT "MonitoringRule_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Team"           ADD CONSTRAINT "Team_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TYPE "OrganizationRole" RENAME TO "TeamRole";

ALTER TABLE "MonitoringRule" ALTER COLUMN "scopeKind" DROP DEFAULT;
ALTER TYPE "RuleScopeKind" RENAME VALUE 'ORGANIZATION' TO 'TEAM';
ALTER TABLE "MonitoringRule" ALTER COLUMN "scopeKind" SET DEFAULT 'TEAM';

UPDATE "PlanFeature" SET "key" = 'team_limit' WHERE "key" = 'org_limit';
