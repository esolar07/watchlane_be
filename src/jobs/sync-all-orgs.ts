import { prisma } from "../lib/prisma";
import { syncMailbox } from "../services/microsoft-mail.service";

async function main() {
  const accounts = await prisma.emailAccount.findMany({
    where: { provider: "MICROSOFT" },
    select: { id: true, emailAddress: true, teamId: true },
  });
  for (const acc of accounts) {
    console.log(`Syncing ${acc.emailAddress} (org=${acc.teamId})...`);
    try {
      await syncMailbox(acc.id);
      console.log(`  done`);
    } catch (err) {
      console.error(`  failed: ${(err as Error).message}`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
