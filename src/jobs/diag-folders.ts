import { prisma } from "../lib/prisma";

async function main() {
  const teamId = "cmmwbmlnh0000ad6hj6zrkqrz";
  const org = await prisma.team.findUnique({ where: { id: teamId } });
  console.log("Org:", org);

  const accounts = await prisma.emailAccount.findMany({
    where: { teamId: teamId },
    select: { id: true, emailAddress: true, provider: true, lastSyncAt: true, foldersDeltaLink: true },
  });
  console.log(`\n${accounts.length} email account(s):`);
  for (const acc of accounts) {
    console.log(`  - ${acc.emailAddress} (${acc.provider}) lastSync=${acc.lastSyncAt} deltaLink=${acc.foldersDeltaLink ? "set" : "null"}`);
    const folders = await prisma.emailFolder.findMany({
      where: { emailAccountId: acc.id },
      select: { id: true, name: true, path: true, parentId: true, systemKind: true, monitored: true, isNew: true },
      orderBy: { path: "asc" },
    });
    console.log(`    Total folders: ${folders.length}`);
    for (const f of folders) console.log(`      path="${f.path}" name="${f.name}" parentId=${f.parentId ?? "ROOT"} system=${f.systemKind} monitored=${f.monitored}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
