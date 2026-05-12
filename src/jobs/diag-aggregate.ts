import { prisma } from "../lib/prisma";
import { getAggregateDashboard } from "../services/dashboard-aggregate.service";

async function main() {
  const teamIds = ["cmmwbmlnh0000ad6hj6zrkqrz", "cmmwk1osw0000z06hdxcufbko"];
  const startDate = new Date("2026-04-25T04:00:00.000Z");
  const endDate = new Date("2026-05-02T03:59:59.999Z");
  const result = await getAggregateDashboard({ teamIds: teamIds, startDate, endDate });
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
