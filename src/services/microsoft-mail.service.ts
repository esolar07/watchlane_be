import { getValidAccessToken } from "../lib/microsoft";
import { prisma } from "../lib/prisma";
import {
  GraphMessage,
  GraphResponse,
  NormalizedMessage,
} from "../types/microsoft";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0/me";
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

async function fetchAllPages(
  url: string,
  accessToken: string
): Promise<GraphMessage[]> {
  const messages: GraphMessage[] = [];
  let nextUrl: string | undefined = url;
  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Microsoft Graph request failed: ${error}`);
    }
    const data = (await res.json()) as GraphResponse;
    messages.push(...data.value);
    nextUrl = data["@odata.nextLink"];
  }
  return messages;
}

export async function fetchMicrosoftMessages(
  emailAccountId: string,
  sinceDate?: Date
): Promise<NormalizedMessage[]> {
  const since =
    sinceDate ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const isoFilter = since.toISOString();
  const account = await prisma.emailAccount.findUniqueOrThrow({
    where: { id: emailAccountId },
  });
  const accessToken = await getValidAccessToken(emailAccountId);
  const filter = `receivedDateTime ge ${isoFilter}`;
  const select =
    "id,conversationId,subject,from,toRecipients,receivedDateTime,body";
  const query = `$filter=${encodeURIComponent(filter)}&$select=${select}&$orderby=receivedDateTime asc&$top=50`;
  const inboxUrl = `${GRAPH_BASE}/mailFolders/Inbox/messages?${query}`;
  const sentUrl = `${GRAPH_BASE}/mailFolders/SentItems/messages?${query}`;

  const [inboxMessages, sentMessages] = await Promise.all([
    fetchAllPages(inboxUrl, accessToken),
    fetchAllPages(sentUrl, accessToken),
  ]);
  const allMessages = [...inboxMessages, ...sentMessages];
  const seen = new Set<string>();
  const unique = allMessages.filter((msg) => {
    if (seen.has(msg.id)) return false;
    seen.add(msg.id);
    return true;
  });
  return unique.map((msg) =>
    normalizeMicrosoftGraphMessage(msg, account.emailAddress)
  );
}


export async function syncMailbox(emailAccountId: string): Promise<void> {
  const account = await prisma.emailAccount.findUniqueOrThrow({
    where: { id: emailAccountId },
  });
  const organizationMembership = await prisma.organizationMember.findFirst({
    where: { userId: account.userId },
  });
  if (!organizationMembership) {
    throw new Error("User has no organization");
  }
  const sinceDate = account.lastSyncAt ?? new Date(Date.now() - INITIAL_SYNC_DAYS * 24 * 60 * 60 * 1000);
  const messages = await fetchMicrosoftMessages(emailAccountId, sinceDate);
  const threadMap = new Map<string, NormalizedMessage[]>();
  for (const msg of  messages) {
    const group = threadMap.get(msg.conversationId) ?? [];
    group.push(msg);
    threadMap.set(msg.conversationId, group);
  }
  for (const [conversationId, threadMessages] of threadMap) {
    threadMessages.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    const firstMsg = threadMessages[0];
    const lastMsg = threadMessages[threadMessages.length - 1];

    const thread = await prisma.thread.upsert({
      where: {
        emailAccountId_externalThreadId: {
          emailAccountId,
          externalThreadId: conversationId,
        },
      },
      update: {
        lastMessageAt: lastMsg.timestamp,
        subject: firstMsg.subject ?? undefined,
      },
      create: {
        organizationId: organizationMembership.organizationId,
        emailAccountId,
        externalThreadId: conversationId,
        subject: firstMsg.subject,
        lastMessageAt: lastMsg.timestamp,
      },
    });

    for (const msg of threadMessages) {
      await prisma.message.upsert({
        where: {
          threadId_externalId: {
            threadId: thread.id,
            externalId: msg.messageId,
          },
        },
        update: {},
        create: {
          threadId: thread.id,
          externalId: msg.messageId,
          direction: msg.direction,
          sender: msg.from,
          recipients: msg.to,
          body: msg.body,
          sentAt: msg.timestamp,
        },
      });
    }

    const allThreadMessages = await prisma.message.findMany({
      where: { threadId: thread.id },
      select: { direction: true, sentAt: true },
      orderBy: { sentAt: "asc" },
    });

    let firstInboundAt: Date | null = null;
    let firstOutboundAt: Date | null = null;
    let lastInboundAt: Date | null = null;
    let lastOutboundAt: Date | null = null;

    for (const m of allThreadMessages) {
      if (m.direction === "INBOUND") {
        if (!firstInboundAt) firstInboundAt = m.sentAt;
        lastInboundAt = m.sentAt;
      } else {
        if (!firstOutboundAt) firstOutboundAt = m.sentAt;
        lastOutboundAt = m.sentAt;
      }
    }

    let coverageStatus: "COVERED" | "UNCOVERED";
    if (!lastInboundAt) {
      coverageStatus = "COVERED";
    } else if (!lastOutboundAt) {
      coverageStatus = "UNCOVERED";
    } else if (lastOutboundAt > lastInboundAt) {
      coverageStatus = "COVERED";
    } else {
      coverageStatus = "UNCOVERED";
    }

    await prisma.thread.update({
      where: { id: thread.id },
      data: {
        firstInboundAt,
        firstOutboundAt,
        lastInboundAt,
        lastOutboundAt,
        coverageStatus,
      },
    });
  }

  await prisma.emailAccount.update({
    where: { id: emailAccountId },
    data: { lastSyncAt: new Date() },
  });
}
