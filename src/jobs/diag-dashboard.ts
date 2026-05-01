import { getDashboardMetrics } from "../services/dashboard.service";
import { prisma } from "../lib/prisma";

async function main() {
  const orgId = "cmmwbmlnh0000ad6hj6zrkqrz";
  const ranges = [
    { name: "last 7 days", days: 7 },
    { name: "last 30 days", days: 30 },
    { name: "last 90 days", days: 90 },
  ];
  for (const r of ranges) {
    const startDate = new Date(Date.now() - r.days * 24 * 60 * 60 * 1000);
    const endDate = new Date();
    const result = await getDashboardMetrics({ organizationId: orgId, startDate, endDate });
    console.log(`\n=== ${r.name} (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}) ===`);
    console.log(`breaches=${result.breaches}  atRisk=${result.atRisk}  coveredWithinSla=${result.coveredWithinSla}  totalInbound=${result.totalInbound}`);
    console.log(`openCount=${result.openCount}  overdueCount=${result.overdueCount}`);
    console.log(`recentActivity types:`);
    const counts: Record<string, number> = {};
    for (const item of result.recentActivity) counts[item.type] = (counts[item.type] ?? 0) + 1;
    for (const [type, count] of Object.entries(counts)) console.log(`  ${type}: ${count}`);
    console.log(`first 5 activity items:`);
    for (const item of result.recentActivity.slice(0, 5)) console.log(`  type=${item.type} subject="${item.subject}" message="${item.message?.slice(0, 60)}..."`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
