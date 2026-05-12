import { prisma } from "../lib/prisma";
import type { EmailFolder } from "../generated/prisma/client";
import type { NormalizedMessage } from "../types/microsoft";

interface IngestArgs {
  emailAccountId: string;
  organizationId: string;
  folder: EmailFolder;
  message: NormalizedMessage;
}

export async function ingestMessageFromFolder(args: IngestArgs): Promise<string> {
  const thread = await upsertThreadForMessage(args);
  const isTracked = await computeIsTrackedAtIngestion(args.folder, thread.id);
  await upsertMessageRow(thread.id, args.message, args.folder.id, isTracked, args.organizationId);
  await refreshThreadFolderIds(thread.id);
  return thread.id;
}

async function upsertThreadForMessage(args: IngestArgs) {
  return prisma.thread.upsert({
    where: { emailAccountId_externalThreadId: { emailAccountId: args.emailAccountId, externalThreadId: args.message.conversationId } },
    update: { lastMessageAt: args.message.timestamp, subject: args.message.subject ?? undefined },
    create: buildThreadCreateData(args),
  });
}

function buildThreadCreateData(args: IngestArgs) {
  return {
    organizationId: args.organizationId,
    emailAccountId: args.emailAccountId,
    externalThreadId: args.message.conversationId,
    subject: args.message.subject,
    lastMessageAt: args.message.timestamp,
  };
}

async function computeIsTrackedAtIngestion(folder: EmailFolder, threadId: string): Promise<boolean> {
  if (folder.systemKind === "SENT_ITEMS") return hasTrackedInboundInThread(threadId);
  if (folder.systemKind === "JUNK_EMAIL" || folder.systemKind === "DELETED_ITEMS") return false;
  return true;
}

async function hasTrackedInboundInThread(threadId: string): Promise<boolean> {
  const found = await prisma.message.findFirst({
    where: { threadId, direction: "INBOUND", isTracked: true },
    select: { id: true },
  });
  return found !== null;
}

async function upsertMessageRow(
  threadId: string,
  msg: NormalizedMessage,
  folderId: string,
  isTracked: boolean,
  organizationId: string
): Promise<void> {
  await prisma.message.upsert({
    where: { threadId_externalId: { threadId, externalId: msg.messageId } },
    update: {},
    create: buildMessageCreateData(threadId, msg, folderId, isTracked, organizationId),
  });
}

function buildMessageCreateData(threadId: string, msg: NormalizedMessage, folderId: string, isTracked: boolean, organizationId: string) {
  return {
    organizationId,
    threadId,
    externalId: msg.messageId,
    direction: msg.direction,
    sender: msg.from,
    recipients: msg.to,
    body: msg.body,
    sentAt: msg.timestamp,
    folderId,
    isTracked,
  };
}

async function refreshThreadFolderIds(threadId: string): Promise<void> {
  const rows = await prisma.message.findMany({
    where: { threadId, folderId: { not: null } },
    select: { folderId: true },
    distinct: ["folderId"],
  });
  const folderIds = rows.map((row) => row.folderId).filter((id): id is string => id !== null);
  await prisma.thread.update({ where: { id: threadId }, data: { folderIds } });
}
