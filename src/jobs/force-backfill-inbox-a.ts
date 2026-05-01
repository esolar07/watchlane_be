import { prisma } from "../lib/prisma";
import { backfillFolder } from "../services/folder-backfill.service";
import { fetchMicrosoftMessagesInFolder } from "../services/microsoft-mail.service";

async function main() {
  const folder = await prisma.emailFolder.findFirstOrThrow({
    where: {
      name: "Email Inbox A",
      emailAccount: { emailAddress: "watchlanedemo@outlook.com" },
    },
    select: { id: true, name: true, externalId: true, emailAccountId: true },
  });
  console.log(`Force-backfilling ${folder.name} (id=${folder.id} extId=${folder.externalId})`);

  const probeMessages = await fetchMicrosoftMessagesInFolder(
    folder.externalId,
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  );
  console.log(`Graph returned ${probeMessages.length} message(s) for the past 30 days:`);
  for (const m of probeMessages.slice(0, 10)) {
    console.log(`  ${m.timestamp.toISOString()} dir=${m.direction} from=${m.from} subject="${m.subject}" convId=${m.conversationId}`);
  }

  console.log("\nRunning backfill...");
  await backfillFolder(folder.id, { fetcher: fetchMicrosoftMessagesInFolder });

  const ingested = await prisma.message.count({ where: { folderId: folder.id } });
  console.log(`After backfill: ${ingested} message(s) ingested under folderId=${folder.id}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
