import { prisma } from "../lib/prisma";
import { GRAPH_BASE, fetchAllPages } from "../lib/microsoft-graph";

interface DeletedGraphMessage {
  id: string;
  conversationId: string;
}

export async function detectDismissedThreads(emailAccountId: string, accessToken: string): Promise<number> {
  const softDeleteCount = await detectSoftDeletes(emailAccountId, accessToken);
  const hardDeleteCount = await detectHardDeletes(emailAccountId, accessToken);
  return softDeleteCount + hardDeleteCount;
}

async function detectSoftDeletes(emailAccountId: string, accessToken: string): Promise<number> {
  const deletedFolder = await prisma.emailFolder.findFirst({
    where: { emailAccountId, systemKind: "DELETED_ITEMS" },
    select: { externalId: true },
  });
  if (!deletedFolder) return 0;
  const deletedMessages = await fetchDeletedItemIds(deletedFolder.externalId, accessToken);
  return markMatchingThreadsAsDismissed(emailAccountId, deletedMessages);
}

async function detectHardDeletes(emailAccountId: string, accessToken: string): Promise<number> {
  const candidates = await loadHardDeleteCandidates(emailAccountId);
  let count = 0;
  for (const candidate of candidates) {
    if (await isMessageGoneFromGraph(candidate.externalId, accessToken)) {
      await prisma.thread.update({ where: { id: candidate.threadId }, data: { dismissedAt: new Date() } });
      count++;
    }
  }
  return count;
}

async function loadHardDeleteCandidates(emailAccountId: string) {
  const threads = await prisma.thread.findMany({
    where: { emailAccountId, dismissedAt: null, coverageStatus: "UNCOVERED" },
    select: { id: true, messages: { where: { direction: "INBOUND" }, select: { externalId: true }, take: 1, orderBy: { sentAt: "asc" } } },
  });
  return threads.filter((t) => t.messages.length > 0).map((t) => ({ threadId: t.id, externalId: t.messages[0].externalId }));
}

async function isMessageGoneFromGraph(externalId: string, accessToken: string): Promise<boolean> {
  const res = await fetch(`${GRAPH_BASE}/messages/${externalId}?$select=id`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return res.status === 404;
}

async function fetchDeletedItemIds(folderExternalId: string, accessToken: string): Promise<DeletedGraphMessage[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const filter = `receivedDateTime ge ${since.toISOString()}`;
  const url = `${GRAPH_BASE}/mailFolders/${folderExternalId}/messages?$filter=${encodeURIComponent(filter)}&$select=id,conversationId&$top=100`;
  return fetchAllPages<DeletedGraphMessage>(url, accessToken);
}

async function markMatchingThreadsAsDismissed(
  emailAccountId: string,
  deletedMessages: DeletedGraphMessage[]
): Promise<number> {
  if (deletedMessages.length === 0) return 0;
  const matchingThreadIds = await findThreadsForDeletedInbounds(emailAccountId, deletedMessages);
  if (matchingThreadIds.length === 0) return 0;
  const result = await prisma.thread.updateMany({
    where: { id: { in: matchingThreadIds }, dismissedAt: null },
    data: { dismissedAt: new Date() },
  });
  return result.count;
}

async function findThreadsForDeletedInbounds(
  emailAccountId: string,
  deletedMessages: DeletedGraphMessage[]
): Promise<string[]> {
  const externalIds = deletedMessages.map((m) => m.id);
  const matches = await prisma.message.findMany({
    where: { externalId: { in: externalIds }, direction: "INBOUND", thread: { emailAccountId } },
    select: { threadId: true },
    distinct: ["threadId"],
  });
  return matches.map((m) => m.threadId);
}
