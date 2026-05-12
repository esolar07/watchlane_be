-- Phase 1: relocate plan from Workspace to User; introduce Workspace.ownerUserId; drop Stripe-related models.
-- Forward-only; zero-loss backfill.

-- 1. Add new columns nullable so backfill can run before NOT NULL is enforced.
ALTER TABLE "User"      ADD COLUMN "currentPlanId"         TEXT;
ALTER TABLE "User"      ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "ownerUserId"           TEXT;

-- 2. Backfill Workspace.ownerUserId from the earliest OWNER membership.
UPDATE "Workspace" w SET "ownerUserId" = sub."userId"
FROM (
  SELECT DISTINCT ON ("workspaceId") "workspaceId", "userId"
  FROM "WorkspaceMember"
  WHERE role = 'OWNER'
  ORDER BY "workspaceId", "createdAt" ASC
) sub
WHERE w."id" = sub."workspaceId";

-- 3. Backfill User.currentPlanId from the user's earliest-owned workspace's plan; fallback to free.
UPDATE "User" u SET "currentPlanId" = COALESCE(
  (
    SELECT w."currentPlanId" FROM "Workspace" w
    WHERE w."ownerUserId" = u."id"
    ORDER BY w."createdAt" ASC
    LIMIT 1
  ),
  (SELECT "id" FROM "Plan" WHERE "slug" = 'free')
);

-- 4. Lock constraints.
ALTER TABLE "User"      ALTER COLUMN "currentPlanId" SET NOT NULL;
ALTER TABLE "Workspace" ALTER COLUMN "ownerUserId"   SET NOT NULL;
ALTER TABLE "User"      ADD CONSTRAINT "User_currentPlanId_fkey"
  FOREIGN KEY ("currentPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "User_currentPlanId_idx" ON "User"("currentPlanId");
CREATE INDEX "Workspace_ownerUserId_idx" ON "Workspace"("ownerUserId");

-- 5. Convert WorkspaceMember(role=OWNER) to ADMIN (ownership is now an FK on Workspace).
UPDATE "WorkspaceMember" SET role = 'ADMIN' WHERE role = 'OWNER';
ALTER TYPE "WorkspaceRole" RENAME TO "WorkspaceRole_old";
CREATE TYPE "WorkspaceRole" AS ENUM ('ADMIN', 'MEMBER');
ALTER TABLE "WorkspaceMember"
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE "WorkspaceRole" USING role::text::"WorkspaceRole",
  ALTER COLUMN role SET DEFAULT 'MEMBER';
DROP TYPE "WorkspaceRole_old";

-- 6. Drop Stripe-related models and the now-redundant Workspace.currentPlanId column.
DROP TABLE IF EXISTS "Subscription";
DROP TABLE IF EXISTS "PlanPrice";
DROP TYPE  IF EXISTS "PlanInterval";

DROP INDEX IF EXISTS "Workspace_currentPlanId_idx";
ALTER TABLE "Workspace" DROP CONSTRAINT IF EXISTS "Workspace_currentPlanId_fkey";
ALTER TABLE "Workspace" DROP COLUMN "currentPlanId";
