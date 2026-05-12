import { prisma } from "../lib/prisma";
import { getOperationalSnapshot } from "../services/dashboard-operational.service";
import { getPerformanceReport } from "../services/dashboard-performance.service";

async function main() {
  const teamId = "cmmwbmlnh0000ad6hj6zrkqrz";

  console.log("=== /api/dashboard/operational ===");
  const op = await getOperationalSnapshot({ teamId: teamId });
  console.log(`slaTarget=${op.slaTarget} lastSyncAt=${op.lastSyncAt?.toISOString()}`);
  console.log(`overdueCount=${op.overdueCount} atRiskCount=${op.atRiskCount} openCount=${op.openCount}`);
  console.log(`oldestUncoveredMinutes=${op.oldestUncoveredMinutes}`);
  console.log(`overdueThreads (${op.overdueThreads.length}):`);
  for (const t of op.overdueThreads.slice(0, 5)) console.log(`  "${t.subject}" waiting ${t.minutesWaiting}m  folder=${t.folderPath}`);
  console.log(`recentActivity types: ${op.recentActivity.map((i) => i.type).slice(0, 10).join(", ")}`);

  console.log("\n=== /api/dashboard/performance (last 90 days) ===");
  const perf = await getPerformanceReport({
    teamId: teamId,
    startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    endDate: new Date(),
  });
  console.log(`slaTarget=${perf.slaTarget}`);
  console.log(`totalInbound=${perf.totalInbound} coveredWithinSla=${perf.coveredWithinSla} lateResponses=${perf.lateResponses} unreplied=${perf.unreplied}`);
  console.log(`compliancePercent=${perf.compliancePercent}% avgResponseMinutes=${perf.avgResponseMinutes}`);
  console.log(`lateResponseThreads (${perf.lateResponseThreads.length}):`);
  for (const t of perf.lateResponseThreads.slice(0, 5)) console.log(`  "${t.subject}" responded in ${t.firstResponseMinutes}m (${t.minutesOverdue}m past SLA)`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
