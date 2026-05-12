-- Phase 3: mark existing users with at least one owned workspace as already onboarded.
-- Users with no owned workspace stay null and will see the wizard on next login.

UPDATE "User" u SET "onboardingCompletedAt" = u."createdAt"
WHERE EXISTS (SELECT 1 FROM "Workspace" w WHERE w."ownerUserId" = u."id");
