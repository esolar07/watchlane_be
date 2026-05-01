-- AlterTable: track when a thread's inbound was deleted from Outlook
ALTER TABLE "Thread" ADD COLUMN "dismissedAt" TIMESTAMP(3);
CREATE INDEX "Thread_organizationId_dismissedAt_idx" ON "Thread"("organizationId", "dismissedAt");
