import { prisma } from "../lib/prisma";
import { syncMailbox } from "../services/microsoft-mail.service";

async function main() {
  const accounts = await prisma.emailAccount.findMany({
    where: { teamId: "cmmwbmlnh0000ad6hj6zrkqrz" },
    select: { id: true, emailAddress: true },
  });
  for (const acc of accounts) {
    console.log(`Syncing ${acc.emailAddress}...`);
    await syncMailbox(acc.id);
    console.log(`  done`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
