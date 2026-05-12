-- Add plan catalog (Plan, PlanFeature, PlanPrice).
-- Migrate Organization & Subscription off the PlanTier enum onto Plan FKs.
-- Drop legacy per-org limit columns (emailLimit, ruleLimit, aiEnabled).
-- All steps run inside one implicit transaction; partial failure leaves the
-- schema unchanged.

-- ============================================
-- Phase 1: New enum + tables
-- ============================================

CREATE TYPE "PlanInterval" AS ENUM ('MONTH', 'YEAR');

CREATE TABLE "Plan" (
    "id"          TEXT NOT NULL,
    "slug"        TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

CREATE TABLE "PlanFeature" (
    "id"     TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "key"    TEXT NOT NULL,
    "value"  TEXT NOT NULL,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanFeature_planId_key_key" ON "PlanFeature"("planId", "key");
CREATE INDEX "PlanFeature_planId_idx" ON "PlanFeature"("planId");

ALTER TABLE "PlanFeature"
  ADD CONSTRAINT "PlanFeature_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlanPrice" (
    "id"            TEXT NOT NULL,
    "planId"        TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "interval"      "PlanInterval" NOT NULL,
    "currency"      TEXT NOT NULL DEFAULT 'usd',
    "unitAmount"    INTEGER NOT NULL,
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanPrice_stripePriceId_key" ON "PlanPrice"("stripePriceId");
CREATE INDEX "PlanPrice_planId_idx" ON "PlanPrice"("planId");
CREATE INDEX "PlanPrice_stripePriceId_idx" ON "PlanPrice"("stripePriceId");

ALTER TABLE "PlanPrice"
  ADD CONSTRAINT "PlanPrice_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- Phase 2: Seed default plans + features
-- (Deterministic IDs so the backfill below can reference them.)
-- ============================================

INSERT INTO "Plan" ("id", "slug", "name", "description", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
  ('plan_free',       'free',       'Free',       'Single mailbox, 7-day history.',         true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_pro',        'pro',        'Pro',        'Up to 5 mailboxes, 30-day history, weekly reports.', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_pro_plus',   'pro_plus',   'Pro+',       'Unlimited mailboxes, advanced rules, multi-team SLAs.', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_enterprise', 'enterprise', 'Enterprise', 'Everything in Pro+ with custom support.', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "PlanFeature" ("id", "planId", "key", "value") VALUES
  ('pf_free_mailbox_limit',   'plan_free', 'mailbox_limit',  '1'),
  ('pf_free_rule_limit',      'plan_free', 'rule_limit',     '3'),
  ('pf_free_history_days',    'plan_free', 'history_days',   '7'),
  ('pf_free_ai_enabled',      'plan_free', 'ai_enabled',     'false'),
  ('pf_free_weekly_reports',  'plan_free', 'weekly_reports', 'false'),
  ('pf_free_advanced_rules',  'plan_free', 'advanced_rules', 'false'),
  ('pf_free_multi_team_sla',  'plan_free', 'multi_team_sla', 'false'),

  ('pf_pro_mailbox_limit',    'plan_pro', 'mailbox_limit',  '5'),
  ('pf_pro_rule_limit',       'plan_pro', 'rule_limit',     '20'),
  ('pf_pro_history_days',     'plan_pro', 'history_days',   '30'),
  ('pf_pro_ai_enabled',       'plan_pro', 'ai_enabled',     'true'),
  ('pf_pro_weekly_reports',   'plan_pro', 'weekly_reports', 'true'),
  ('pf_pro_advanced_rules',   'plan_pro', 'advanced_rules', 'false'),
  ('pf_pro_multi_team_sla',   'plan_pro', 'multi_team_sla', 'false'),

  ('pf_pro_plus_mailbox_limit',   'plan_pro_plus', 'mailbox_limit',  'unlimited'),
  ('pf_pro_plus_rule_limit',      'plan_pro_plus', 'rule_limit',     'unlimited'),
  ('pf_pro_plus_history_days',    'plan_pro_plus', 'history_days',   'unlimited'),
  ('pf_pro_plus_ai_enabled',      'plan_pro_plus', 'ai_enabled',     'true'),
  ('pf_pro_plus_weekly_reports',  'plan_pro_plus', 'weekly_reports', 'true'),
  ('pf_pro_plus_advanced_rules',  'plan_pro_plus', 'advanced_rules', 'true'),
  ('pf_pro_plus_multi_team_sla',  'plan_pro_plus', 'multi_team_sla', 'true'),

  ('pf_enterprise_mailbox_limit',  'plan_enterprise', 'mailbox_limit',  'unlimited'),
  ('pf_enterprise_rule_limit',     'plan_enterprise', 'rule_limit',     'unlimited'),
  ('pf_enterprise_history_days',   'plan_enterprise', 'history_days',   'unlimited'),
  ('pf_enterprise_ai_enabled',     'plan_enterprise', 'ai_enabled',     'true'),
  ('pf_enterprise_weekly_reports', 'plan_enterprise', 'weekly_reports', 'true'),
  ('pf_enterprise_advanced_rules', 'plan_enterprise', 'advanced_rules', 'true'),
  ('pf_enterprise_multi_team_sla', 'plan_enterprise', 'multi_team_sla', 'true');

-- ============================================
-- Phase 3: Migrate Organization off PlanTier
-- ============================================

ALTER TABLE "Organization" ADD COLUMN "currentPlanId" TEXT;

UPDATE "Organization" SET "currentPlanId" = CASE "planTier"
  WHEN 'FREE'       THEN 'plan_free'
  WHEN 'PRO'        THEN 'plan_pro'
  WHEN 'PREMIUM'    THEN 'plan_pro_plus'
  WHEN 'ENTERPRISE' THEN 'plan_enterprise'
  ELSE 'plan_free'
END;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Organization" WHERE "currentPlanId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: Organization rows have NULL currentPlanId';
  END IF;
END $$;

ALTER TABLE "Organization" ALTER COLUMN "currentPlanId" SET NOT NULL;

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_currentPlanId_fkey"
  FOREIGN KEY ("currentPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Organization_currentPlanId_idx" ON "Organization"("currentPlanId");

ALTER TABLE "Organization" DROP COLUMN "planTier";
ALTER TABLE "Organization" DROP COLUMN "emailLimit";
ALTER TABLE "Organization" DROP COLUMN "ruleLimit";
ALTER TABLE "Organization" DROP COLUMN "aiEnabled";

-- ============================================
-- Phase 4: Migrate Subscription off PlanTier
-- ============================================

ALTER TABLE "Subscription" ADD COLUMN "planId" TEXT;

UPDATE "Subscription" SET "planId" = CASE "planTier"
  WHEN 'FREE'       THEN 'plan_free'
  WHEN 'PRO'        THEN 'plan_pro'
  WHEN 'PREMIUM'    THEN 'plan_pro_plus'
  WHEN 'ENTERPRISE' THEN 'plan_enterprise'
  ELSE 'plan_free'
END;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Subscription" WHERE "planId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: Subscription rows have NULL planId';
  END IF;
END $$;

ALTER TABLE "Subscription" ALTER COLUMN "planId" SET NOT NULL;

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

ALTER TABLE "Subscription" DROP COLUMN "planTier";

-- ============================================
-- Phase 5: Drop legacy enums
-- ============================================

DROP TYPE "PlanTier";
DROP TYPE "FeatureFlag";
