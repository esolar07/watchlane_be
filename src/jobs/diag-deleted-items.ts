import { prisma } from "../lib/prisma";
import { getValidAccessToken } from "../lib/microsoft";
import { GRAPH_BASE, fetchAllPages } from "../lib/microsoft-graph";

interface GraphMsg { id: string; conversationId: string; subject: string; receivedDateTime: string; }

async function main() {
  const account = await prisma.emailAccount.findFirstOrThrow({
    where: { emailAddress: "watchlanedemo@outlook.com" },
    select: { id: true },
  });
  const deletedFolder = await prisma.emailFolder.findFirstOrThrow({
    where: { emailAccountId: account.id, systemKind: "DELETED_ITEMS" },
    select: { externalId: true },
  });
  const accessToken = await getValidAccessToken(account.id);

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const filter = `receivedDateTime ge ${since.toISOString()}`;
  const url = `${GRAPH_BASE}/mailFolders/${deletedFolder.externalId}/messages?$filter=${encodeURIComponent(filter)}&$select=id,conversationId,subject,receivedDateTime&$top=100`;
  const messages = await fetchAllPages<GraphMsg>(url, accessToken);
  console.log(`Found ${messages.length} message(s) in Deleted Items in past 30 days:`);
  for (const m of messages) {
    const inDb = await prisma.message.findFirst({ where: { externalId: m.id }, select: { id: true, threadId: true, direction: true, thread: { select: { subject: true, dismissedAt: true } } } });
    console.log(`  ${m.receivedDateTime} subject="${m.subject}" id=${m.id.slice(0, 30)}...`);
    console.log(`    inOurDb=${inDb ? "YES" : "NO"}${inDb ? ` direction=${inDb.direction} threadDismissedAt=${inDb.thread.dismissedAt?.toISOString() ?? "NULL"}` : ""}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
