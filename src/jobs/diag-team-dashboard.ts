import { prisma } from "../lib/prisma";
import { getTeamDashboard } from "../services/dashboard-team.service";

async function main() {
  const result = await getTeamDashboard({
    teamId: "cmmwbmlnh0000ad6hj6zrkqrz",
    startDate: new Date("2026-04-25T04:00:00.000Z"),
    endDate: new Date("2026-05-02T03:59:59.999Z"),
  });
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
