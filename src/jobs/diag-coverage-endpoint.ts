import { prisma } from "../lib/prisma";
import { getDashboardMetrics } from "../services/dashboard.service";

async function main() {
  const orgs = ["cmmwbmlnh0000ad6hj6zrkqrz", "cmmwk1osw0000z06hdxcufbko"];
  const startDate = new Date("2026-04-25T04:00:00.000Z");
  const endDate = new Date("2026-05-02T03:59:59.999Z");
  for (const orgId of orgs) {
    const r = await getDashboardMetrics({ organizationId: orgId, startDate, endDate });
    console.log(`\n=== org ${orgId} ===`);
    console.log(`compliancePercent=${r.compliancePercent}% totalInbound=${r.totalInbound} coveredWithinSla=${r.coveredWithinSla} breaches=${r.breaches} atRisk=${r.atRisk}`);
    console.log(`avgResponseMinutes=${r.avgResponseMinutes} oldestUncoveredMinutes=${r.oldestUncoveredMinutes}`);
    console.log(`openCount=${r.openCount} overdueCount=${r.overdueCount}`);
    console.log(`recentActivity types: ${r.recentActivity.map((i) => i.type).join(", ")}`);
    console.log(`first 3 openThreads: ${r.openThreads.slice(0, 3).map((t) => `"${t.subject}"`).join(" | ")}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
