import { prisma } from "../lib/prisma";

async function main() {
  const negatives = await prisma.thread.findMany({
    where: { firstResponseMinutes: { lt: 0 } },
    select: { id: true, subject: true, firstResponseMinutes: true },
  });
  console.log(`Found ${negatives.length} thread(s) with negative firstResponseMinutes:`);
  for (const t of negatives) console.log(`  "${t.subject}" was ${t.firstResponseMinutes} min`);

  const result = await prisma.thread.updateMany({
    where: { firstResponseMinutes: { lt: 0 } },
    data: { firstResponseMinutes: null, hadLateFirstResponse: false },
  });
  console.log(`\nNullified ${result.count} thread(s).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
