-- Drop Team.inviteCode column. Link-based invites are removed; admins add members by email.

ALTER TABLE "Team" DROP CONSTRAINT IF EXISTS "Team_inviteCode_key";
DROP INDEX IF EXISTS "Team_inviteCode_key";
ALTER TABLE "Team" DROP COLUMN IF EXISTS "inviteCode";
