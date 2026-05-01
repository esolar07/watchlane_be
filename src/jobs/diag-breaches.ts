import { prisma } from "../lib/prisma";

async function main() {
  const orgId = "cmmwbmlnh0000ad6hj6zrkqrz";
  const settings = await prisma.organizationSettings.findUnique({ where: { organizationId: orgId } });
  const slaMin = settings?.slaMinutes ?? 560;
  console.log(`SLA target: ${slaMin} minutes (${(slaMin / 60).toFixed(1)} hours)`);

  const account = await prisma.emailAccount.findFirstOrThrow({
    where: { organizationId: orgId },
    select: { id: true, lastSyncAt: true },
  });
  console.log(`lastSync: ${account.lastSyncAt?.toISOString()}\n`);

  const threads = await prisma.thread.findMany({
    where: { organizationId: orgId },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, subject: true, firstInboundAt: true, firstOutboundAt: true, lastInboundAt: true, lastOutboundAt: true, lastMessageAt: true, coverageStatus: true, folderIds: true },
  });

  console.log(`${threads.length} thread(s) ranked by lastMessageAt desc:`);
  for (const t of threads) {
    const fIn = t.firstInboundAt;
    const fOut = t.firstOutboundAt;
    let firstResponseMin: string = "—";
    let firstClassification: string = "—";
    if (fIn && fOut) {
      const diff = Math.round((fOut.getTime() - fIn.getTime()) / 60000);
      firstResponseMin = `${diff} min`;
      firstClassification = diff <= slaMin ? "COVERED" : "BREACH (first-response)";
    } else if (fIn && !fOut) {
      const elapsed = Math.round((Date.now() - fIn.getTime()) / 60000);
      firstResponseMin = `no reply / ${elapsed} min elapsed`;
      firstClassification = elapsed > slaMin ? "BREACH (currently overdue)" : "OK so far";
    }
    const lIn = t.lastInboundAt;
    const lOut = t.lastOutboundAt;
    let latestState = "—";
    if (lIn && lOut) latestState = lOut > lIn ? `caught up (replied ${Math.round((lOut.getTime() - lIn.getTime()) / 60000)} min after last inbound)` : `OPEN (last inbound newer than last outbound)`;
    else if (lIn && !lOut) latestState = `OPEN (no reply ever)`;

    console.log(`  "${t.subject}"`);
    console.log(`    firstInboundAt=${fIn?.toISOString() ?? "NULL"}  firstOutboundAt=${fOut?.toISOString() ?? "NULL"}`);
    console.log(`    first-response: ${firstResponseMin}  → dashboard says: ${firstClassification}`);
    console.log(`    coverageStatus=${t.coverageStatus}  latest-state: ${latestState}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
