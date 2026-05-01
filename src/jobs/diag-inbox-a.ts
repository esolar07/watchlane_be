import { prisma } from "../lib/prisma";

async function main() {
  const account = await prisma.emailAccount.findFirstOrThrow({
    where: { emailAddress: "watchlanedemo@outlook.com" },
    select: { id: true, lastSyncAt: true },
  });
  console.log(`Now: ${new Date().toISOString()}  lastSync: ${account.lastSyncAt?.toISOString()}`);

  const folders = await prisma.emailFolder.findMany({
    where: { emailAccountId: account.id, name: { contains: "Inbox A" } },
    select: { id: true, name: true, monitored: true, externalId: true },
  });
  for (const f of folders) console.log(`Folder ${f.name}: id=${f.id} monitored=${f.monitored} externalId=${f.externalId}`);

  const messagesInInboxA = await prisma.message.findMany({
    where: { folderId: { in: folders.map((f) => f.id) } },
    select: { externalId: true, direction: true, sentAt: true, sender: true, isTracked: true, thread: { select: { externalThreadId: true, subject: true, firstInboundAt: true } } },
    orderBy: { sentAt: "desc" },
    take: 20,
  });
  console.log(`\n${messagesInInboxA.length} message(s) in Email Inbox A folders:`);
  for (const m of messagesInInboxA) {
    console.log(`  ${m.sentAt.toISOString()} dir=${m.direction} from=${m.sender} subject="${m.thread.subject}" convId=${m.thread.externalThreadId} threadFirstInbound=${m.thread.firstInboundAt?.toISOString() ?? "NULL"}`);
  }

  const inboxAReplyThread = await prisma.thread.findFirst({
    where: { subject: { contains: "Inbox A" } },
    select: { id: true, externalThreadId: true, firstInboundAt: true, firstOutboundAt: true, folderIds: true, messages: { select: { externalId: true, direction: true, sentAt: true, folderId: true, isTracked: true } } },
  });
  if (inboxAReplyThread) {
    console.log(`\n"Re: Inbox A" thread state:`);
    console.log(`  threadId=${inboxAReplyThread.id} externalThreadId=${inboxAReplyThread.externalThreadId}`);
    console.log(`  firstInboundAt=${inboxAReplyThread.firstInboundAt?.toISOString() ?? "NULL"} firstOutboundAt=${inboxAReplyThread.firstOutboundAt?.toISOString() ?? "NULL"}`);
    console.log(`  folderIds=[${inboxAReplyThread.folderIds.join(", ")}]`);
    console.log(`  ${inboxAReplyThread.messages.length} message(s):`);
    for (const m of inboxAReplyThread.messages) console.log(`    ${m.sentAt.toISOString()} dir=${m.direction} folderId=${m.folderId} isTracked=${m.isTracked}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
