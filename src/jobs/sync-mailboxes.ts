import { schedule, type ScheduledTask } from "node-cron";
import { prisma } from "../lib/prisma";
import { syncMailbox } from "../services/microsoft-mail.service";

export async function syncAllMailboxes() {
  const accounts = await prisma.emailAccount.findMany({
    select: { id: true, emailAddress: true },
  });
  console.log(`[sync] Starting sync for ${accounts.length} account(s)`);
  for (const account of accounts) {
    try {
      await syncMailbox(account.id);
      console.log(`[sync] Synced ${account.emailAddress}`);
    } catch (err) {
      console.error(`[sync] Failed to sync ${account.emailAddress}:`, err);
    }
  }
}

export async function syncUserMailboxes(userId: string) {
  const accounts = await prisma.emailAccount.findMany({
    where: { userId },
    select: { id: true, emailAddress: true },
  });
  console.log(`[sync] Starting user sync for ${accounts.length} account(s)`);
  for (const account of accounts) {
    try {
      await syncMailbox(account.id);
      console.log(`[sync] Synced ${account.emailAddress}`);
    } catch (err) {
      console.error(`[sync] Failed to sync ${account.emailAddress}:`, err);
    }
  }
}

