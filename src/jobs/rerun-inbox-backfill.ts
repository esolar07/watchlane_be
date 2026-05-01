import { prisma } from "../lib/prisma";
import { backfillFolder } from "../services/folder-backfill.service";
import { fetchMicrosoftMessagesInFolder } from "../services/microsoft-mail.service";

async function main() {
  const folders = await prisma.emailFolder.findMany({
    where: {
      name: { in: ["Email Inbox A", "Email Inbox B", "Email Inbox C"] },
      emailAccount: { emailAddress: "watchlanedemo@outlook.com" },
    },
    select: { id: true, name: true },
  });
  for (const folder of folders) {
    console.log(`Backfilling ${folder.name}...`);
    await backfillFolder(folder.id, { fetcher: fetchMicrosoftMessagesInFolder });
    const count = await prisma.message.count({ where: { folderId: folder.id } });
    console.log(`  → ${count} message(s) now in DB for ${folder.name}`);
  }

  const inboxAThread = await prisma.thread.findFirst({
    where: { subject: { contains: "Inbox A" } },
    select: { id: true, firstInboundAt: true, firstOutboundAt: true, coverageStatus: true, folderIds: true, messages: { select: { direction: true, sentAt: true, isTracked: true } } },
  });
  console.log(`\n"Re: Inbox A" thread state after backfill:`);
  console.log(`  firstInboundAt=${inboxAThread?.firstInboundAt?.toISOString() ?? "NULL"}`);
  console.log(`  firstOutboundAt=${inboxAThread?.firstOutboundAt?.toISOString() ?? "NULL"}`);
  console.log(`  coverageStatus=${inboxAThread?.coverageStatus}`);
  console.log(`  folderIds=[${inboxAThread?.folderIds.join(", ")}]`);
  console.log(`  ${inboxAThread?.messages.length} message(s):`);
  for (const m of inboxAThread?.messages ?? []) console.log(`    ${m.sentAt.toISOString()} dir=${m.direction} isTracked=${m.isTracked}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
