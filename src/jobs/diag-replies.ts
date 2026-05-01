import { prisma } from "../lib/prisma";

async function main() {
  const orgId = "cmmwbmlnh0000ad6hj6zrkqrz";
  const accounts = await prisma.emailAccount.findMany({
    where: { organizationId: orgId },
    select: { id: true, emailAddress: true, lastSyncAt: true },
  });
  console.log("Now:", new Date().toISOString());
  console.log("\nAccounts:");
  for (const a of accounts) console.log(`  ${a.emailAddress}  lastSync=${a.lastSyncAt?.toISOString() ?? "NEVER"}`);

  const threadCount = await prisma.thread.count({ where: { organizationId: orgId } });
  const messageCount = await prisma.message.count({ where: { thread: { organizationId: orgId } } });
  console.log(`\nTotals: ${threadCount} threads, ${messageCount} messages`);

  console.log("\nMessages by folder (top 10 by count):");
  const msgByFolder = await prisma.message.groupBy({
    by: ["folderId"],
    where: { thread: { organizationId: orgId } },
    _count: true,
  });
  for (const row of msgByFolder) {
    const folder = row.folderId ? await prisma.emailFolder.findUnique({ where: { id: row.folderId }, select: { path: true, systemKind: true } }) : null;
    console.log(`  folderId=${row.folderId ?? "NULL"} (${folder?.path ?? "—"}) count=${row._count}`);
  }

  console.log("\nMost recent 10 threads:");
  const recentThreads = await prisma.thread.findMany({
    where: { organizationId: orgId },
    orderBy: { lastMessageAt: "desc" },
    take: 10,
    select: { id: true, subject: true, firstInboundAt: true, firstOutboundAt: true, lastInboundAt: true, lastOutboundAt: true, lastMessageAt: true, coverageStatus: true, folderIds: true, externalThreadId: true },
  });
  for (const t of recentThreads) {
    console.log(`  thread ${t.id}`);
    console.log(`    subject="${t.subject}"`);
    console.log(`    firstInboundAt=${t.firstInboundAt?.toISOString() ?? "NULL"}  firstOutboundAt=${t.firstOutboundAt?.toISOString() ?? "NULL"}`);
    console.log(`    lastMessageAt=${t.lastMessageAt.toISOString()}  coverage=${t.coverageStatus}`);
    console.log(`    folderIds=[${t.folderIds.join(", ")}]`);
  }

  console.log("\nMost recent 10 outbound messages:");
  const recentSent = await prisma.message.findMany({
    where: { thread: { organizationId: orgId }, direction: "OUTBOUND" },
    orderBy: { sentAt: "desc" },
    take: 10,
    select: { externalId: true, sentAt: true, isTracked: true, folderId: true, thread: { select: { subject: true, firstInboundAt: true } } },
  });
  for (const m of recentSent) {
    console.log(`  sentAt=${m.sentAt.toISOString()} subject="${m.thread.subject}" isTracked=${m.isTracked} folderId=${m.folderId} firstInboundAt=${m.thread.firstInboundAt?.toISOString() ?? "NULL"}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
