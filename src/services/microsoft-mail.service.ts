import { getValidAccessToken } from "../lib/microsoft";
import { prisma } from "../lib/prisma";
import { GRAPH_BASE, fetchAllPages } from "../lib/microsoft-graph";
import { syncFolderTree } from "./folder-sync.service";
import { listEffectiveMonitoredFolders } from "./folder-monitoring.service";
import { ingestMessageFromFolder } from "./message-sync.service";
import { recomputeThreadCoverage } from "./thread-coverage.service";
import { detectDismissedThreads } from "./dismiss-detection.service";
import type { EmailFolder } from "../generated/prisma/client";
import {
  GraphMessage,
  NormalizedMessage,
} from "../types/microsoft";

const INITIAL_SYNC_DAYS = 14;

export function normalizeMicrosoftGraphMessage(
  msg: GraphMessage,
  accountEmail: string
): NormalizedMessage {
  const from = msg.from.emailAddress.address;
  const isOutbound = from.toLowerCase() === accountEmail.toLowerCase();
  return {
    messageId: msg.id,
    conversationId: msg.conversationId,
    subject: msg.subject,
    from,
    to: msg.toRecipients.map((r) => r.emailAddress.address),
    body: msg.body.content,
    timestamp: new Date(msg.receivedDateTime),
    direction: isOutbound ? "OUTBOUND" : "INBOUND",
  };
}

export async function fetchMessagesInFolder(
  folder: EmailFolder,
  accessToken: string,
  since: Date
): Promise<NormalizedMessage[]> {
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: folder.emailAccountId } });
  const url = buildFolderMessagesUrl(folder.externalId, since);
  const raw = await fetchAllPages<GraphMessage>(url, accessToken);
  return raw.map((msg) => normalizeMicrosoftGraphMessage(msg, account.emailAddress));
}

function buildFolderMessagesUrl(folderExternalId: string, since: Date): string {
  const filter = `receivedDateTime ge ${since.toISOString()}`;
  const select = "id,conversationId,subject,from,toRecipients,receivedDateTime,body";
  const query = `$filter=${encodeURIComponent(filter)}&$select=${select}&$orderby=receivedDateTime asc&$top=50`;
  return `${GRAPH_BASE}/mailFolders/${folderExternalId}/messages?${query}`;
}

export async function fetchMicrosoftMessagesInFolder(
  folderExternalId: string,
  since: Date
): Promise<NormalizedMessage[]> {
  const folder = await prisma.emailFolder.findFirstOrThrow({ where: { externalId: folderExternalId } });
  const accessToken = await getValidAccessToken(folder.emailAccountId);
  return fetchMessagesInFolder(folder, accessToken, since);
}

export async function syncMailbox(emailAccountId: string): Promise<void> {
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: emailAccountId } });
  const accessToken = await getValidAccessToken(emailAccountId);
  await syncFolderTree(emailAccountId, accessToken);
  const targetFolders = await collectFoldersToSync(emailAccountId);
  const since = account.lastSyncAt ?? new Date(Date.now() - INITIAL_SYNC_DAYS * 24 * 60 * 60 * 1000);
  for (const folder of targetFolders) {
    await syncMessagesFromFolder(account, folder, accessToken, since);
  }
  await detectDismissedThreads(emailAccountId, accessToken);
  await prisma.emailAccount.update({ where: { id: emailAccountId }, data: { lastSyncAt: new Date() } });
}

async function collectFoldersToSync(emailAccountId: string): Promise<EmailFolder[]> {
  const monitored = await listEffectiveMonitoredFolders(emailAccountId);
  const sentFolder = await prisma.emailFolder.findFirst({
    where: { emailAccountId, systemKind: "SENT_ITEMS" },
  });
  if (!sentFolder) return monitored;
  return monitored.some((folder) => folder.id === sentFolder.id) ? monitored : [...monitored, sentFolder];
}

async function syncMessagesFromFolder(
  account: { id: string; teamId: string },
  folder: EmailFolder,
  accessToken: string,
  since: Date
): Promise<void> {
  const messages = await fetchMessagesInFolder(folder, accessToken, since);
  const sorted = messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const touchedThreads = new Set<string>();
  for (const message of sorted) {
    const threadId = await ingestMessageFromFolder({
      emailAccountId: account.id,
      teamId: account.teamId,
      folder,
      message,
    });
    touchedThreads.add(threadId);
  }
  for (const threadId of touchedThreads) await recomputeThreadCoverage(threadId);
}
