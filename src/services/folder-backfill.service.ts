import { prisma } from "../lib/prisma";
import { ingestMessageFromFolder } from "./message-sync.service";
import { recomputeThreadCoverage } from "./thread-coverage.service";
import type { NormalizedMessage } from "../types/microsoft";
import type { EmailFolder } from "../generated/prisma/client";

const BACKFILL_DAYS = 30;

export type BackfillFetcher = (
  folderExternalId: string,
  since: Date
) => Promise<NormalizedMessage[]>;

interface BackfillOptions {
  now?: Date;
  fetcher: BackfillFetcher;
}

export async function backfillFolder(folderId: string, opts: BackfillOptions): Promise<void> {
  const now = opts.now ?? new Date();
  const folder = await prisma.emailFolder.findUniqueOrThrow({ where: { id: folderId } });
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: folder.emailAccountId } });
  const since = computeBackfillWindow(now);
  const messages = await opts.fetcher(folder.externalId, since);
  const inWindow = filterAndSortMessages(messages, since);
  const threadIds = await ingestAllMessages(account, folder, inWindow);
  for (const threadId of threadIds) await recomputeThreadCoverage(threadId);
}

async function ingestAllMessages(
  account: { id: string; teamId: string },
  folder: EmailFolder,
  messages: NormalizedMessage[]
): Promise<Set<string>> {
  const threadIds = new Set<string>();
  for (const message of messages) {
    const threadId = await ingestMessageFromFolder({
      emailAccountId: account.id,
      teamId: account.teamId,
      folder,
      message,
    });
    threadIds.add(threadId);
  }
  return threadIds;
}

function filterAndSortMessages(messages: NormalizedMessage[], since: Date): NormalizedMessage[] {
  return messages
    .filter((m) => m.timestamp >= since)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function computeBackfillWindow(now: Date): Date {
  return new Date(now.getTime() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
}
