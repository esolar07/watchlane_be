-- Introduce the Workspace layer between User and Organization.
-- Workspace owns the plan + Stripe subscription. Each existing Organization
-- gets its own Workspace (1:1 backfill); its OWNER OrganizationMember is
-- promoted into a WorkspaceMember(OWNER). After backfill, Org.currentPlanId
-- is dropped and Subscription is repointed at Workspace.
--
-- Also refreshes the seeded PlanFeature rows: drops ai_enabled / rule_limit /
-- advanced_rules / multi_team_sla; adds org_limit / folder_monitoring /
-- priority_support; updates pro.history_days 30 → 90.

-- ============================================
-- Phase 1: New enum + tables
-- ============================================

CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

CREATE TABLE "Workspace" (
    "id"            TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "currentPlanId" TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Workspace_currentPlanId_idx" ON "Workspace"("currentPlanId");

ALTER TABLE "Workspace"
  ADD CONSTRAINT "Workspace_currentPlanId_fkey"
  FOREIGN KEY ("currentPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WorkspaceMember" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role"        "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceMember_userId_workspaceId_key" ON "WorkspaceMember"("userId", "workspaceId");
CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");

ALTER TABLE "WorkspaceMember"
  ADD CONSTRAINT "WorkspaceMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceMember"
  ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- Phase 2: Backfill Workspaces from existing Organizations
-- One Workspace per Org. Deterministic ID = 'ws_' || org.id so the joins
-- below stay simple and the migration is re-readable.
-- ============================================

INSERT INTO "Workspace" ("id", "name", "currentPlanId", "createdAt", "updatedAt")
SELECT 'ws_' || o."id", o."name", o."currentPlanId", o."createdAt", o."updatedAt"
FROM "Organization" o;

INSERT INTO "WorkspaceMember" ("id", "userId", "workspaceId", "role", "createdAt")
SELECT 'wm_' || om."id",
       om."userId",
       'ws_' || om."organizationId",
       'OWNER'::"WorkspaceRole",
       CURRENT_TIMESTAMP
FROM "OrganizationMember" om
WHERE om."role" = 'OWNER'
ON CONFLICT ("userId", "workspaceId") DO NOTHING;

-- Fallback: if any existing Org has no OWNER (shouldn't happen, but defensive),
-- promote the first member as the workspace owner.
INSERT INTO "WorkspaceMember" ("id", "userId", "workspaceId", "role", "createdAt")
SELECT 'wm_fallback_' || om."id",
       om."userId",
       'ws_' || om."organizationId",
       'OWNER'::"WorkspaceRole",
       CURRENT_TIMESTAMP
FROM "OrganizationMember" om
WHERE NOT EXISTS (
  SELECT 1 FROM "WorkspaceMember" wm
  WHERE wm."workspaceId" = 'ws_' || om."organizationId"
)
ON CONFLICT ("userId", "workspaceId") DO NOTHING;

-- ============================================
-- Phase 3: Attach Organization.workspaceId
-- ============================================

ALTER TABLE "Organization" ADD COLUMN "workspaceId" TEXT;

UPDATE "Organization" SET "workspaceId" = 'ws_' || "id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Organization" WHERE "workspaceId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: Organization rows have NULL workspaceId';
  END IF;
END $$;

ALTER TABLE "Organization" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Organization_workspaceId_idx" ON "Organization"("workspaceId");

-- ============================================
-- Phase 4: Repoint Subscription at Workspace
-- ============================================

ALTER TABLE "Subscription" DROP CONSTRAINT IF EXISTS "Subscription_organizationId_fkey";

ALTER TABLE "Subscription" ADD COLUMN "workspaceId" TEXT;

UPDATE "Subscription" SET "workspaceId" = 'ws_' || "organizationId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Subscription" WHERE "workspaceId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: Subscription rows have NULL workspaceId';
  END IF;
END $$;

ALTER TABLE "Subscription" ALTER COLUMN "workspaceId" SET NOT NULL;

DROP INDEX IF EXISTS "Subscription_organizationId_key";
ALTER TABLE "Subscription" DROP COLUMN "organizationId";

CREATE UNIQUE INDEX "Subscription_workspaceId_key" ON "Subscription"("workspaceId");

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- Phase 5: Drop Organization.currentPlanId
-- ============================================

ALTER TABLE "Organization" DROP CONSTRAINT IF EXISTS "Organization_currentPlanId_fkey";
DROP INDEX IF EXISTS "Organization_currentPlanId_idx";
ALTER TABLE "Organization" DROP COLUMN "currentPlanId";

-- ============================================
-- Phase 6: Refresh PlanFeature rows for the new feature set
--   Drop:   ai_enabled, rule_limit, advanced_rules, multi_team_sla
--   Add:    org_limit, folder_monitoring, priority_support
--   Update: pro.history_days = 90
-- ============================================

DELETE FROM "PlanFeature"
WHERE "key" IN ('ai_enabled', 'rule_limit', 'advanced_rules', 'multi_team_sla');

UPDATE "PlanFeature"
SET "value" = '90'
WHERE "planId" = 'plan_pro' AND "key" = 'history_days';

INSERT INTO "PlanFeature" ("id", "planId", "key", "value") VALUES
  ('pf_free_org_limit',             'plan_free',       'org_limit',         '3'),
  ('pf_pro_org_limit',              'plan_pro',        'org_limit',         'unlimited'),
  ('pf_pro_plus_org_limit',         'plan_pro_plus',   'org_limit',         'unlimited'),
  ('pf_enterprise_org_limit',       'plan_enterprise', 'org_limit',         'unlimited'),

  ('pf_free_folder_monitoring',       'plan_free',       'folder_monitoring', 'false'),
  ('pf_pro_folder_monitoring',        'plan_pro',        'folder_monitoring', 'true'),
  ('pf_pro_plus_folder_monitoring',   'plan_pro_plus',   'folder_monitoring', 'true'),
  ('pf_enterprise_folder_monitoring', 'plan_enterprise', 'folder_monitoring', 'true'),

  ('pf_free_priority_support',        'plan_free',       'priority_support',  'false'),
  ('pf_pro_priority_support',         'plan_pro',        'priority_support',  'false'),
  ('pf_pro_plus_priority_support',    'plan_pro_plus',   'priority_support',  'true'),
  ('pf_enterprise_priority_support',  'plan_enterprise', 'priority_support',  'true');
