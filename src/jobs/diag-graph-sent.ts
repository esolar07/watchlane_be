import { prisma } from "../lib/prisma";
import { getValidAccessToken } from "../lib/microsoft";
import { fetchMicrosoftMessagesInFolder } from "../services/microsoft-mail.service";

async function main() {
  const account = await prisma.emailAccount.findFirstOrThrow({
    where: { emailAddress: "watchlanedemo@outlook.com" },
    select: { id: true, lastSyncAt: true },
  });
  console.log(`lastSyncAt: ${account.lastSyncAt?.toISOString()}`);
  console.log(`now:        ${new Date().toISOString()}\n`);

  const sentFolder = await prisma.emailFolder.findFirstOrThrow({
    where: { emailAccountId: account.id, systemKind: "SENT_ITEMS" },
    select: { externalId: true },
  });

  const since = new Date(Date.now() - 4 * 60 * 60 * 1000);
  console.log(`Querying Microsoft Graph for Sent Items since ${since.toISOString()}\n`);
  const messages = await fetchMicrosoftMessagesInFolder(sentFolder.externalId, since);
  console.log(`Graph returned ${messages.length} sent message(s) in past 4 hours:`);
  for (const m of messages) {
    const inDb = await prisma.message.findFirst({ where: { externalId: m.messageId }, select: { id: true } });
    console.log(`  ${m.timestamp.toISOString()} subject="${m.subject}" convId=${m.conversationId.slice(0, 30)}...  inDb=${inDb ? "YES" : "NO"}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
