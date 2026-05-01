import { prisma } from "../lib/prisma";
import { backfillFolder } from "../services/folder-backfill.service";
import { fetchMicrosoftMessagesInFolder } from "../services/microsoft-mail.service";

const TARGET_FOLDER_NAMES = ["Email Inbox A", "Email Inbox B", "Email Inbox C"];
const TARGET_EMAIL = "watchlanedemo@outlook.com";

async function main() {
  const account = await prisma.emailAccount.findFirstOrThrow({
    where: { emailAddress: TARGET_EMAIL },
    select: { id: true, emailAddress: true },
  });
  console.log(`Targeting account: ${account.emailAddress} (${account.id})`);

  const folders = await prisma.emailFolder.findMany({
    where: { emailAccountId: account.id, name: { in: TARGET_FOLDER_NAMES } },
    select: { id: true, name: true, monitored: true },
  });
  console.log(`Found ${folders.length} folder(s): ${folders.map((f) => f.name).join(", ")}`);

  for (const folder of folders) {
    if (folder.monitored === true) {
      console.log(`  ${folder.name}: already monitored, skipping`);
      continue;
    }
    console.log(`  ${folder.name}: enabling monitoring + running 30-day backfill...`);
    await prisma.emailFolder.update({ where: { id: folder.id }, data: { monitored: true } });
    await backfillFolder(folder.id, { fetcher: fetchMicrosoftMessagesInFolder });
    console.log(`  ${folder.name}: done`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
