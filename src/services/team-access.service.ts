import { prisma } from "../lib/prisma";
import { NotAuthorizedError } from "../lib/errors";

const MANAGE_TEAM_ERROR = "Only team OWNER/ADMIN or workspace owner can perform this action";

async function isWorkspaceOwnerOfTeam(callerUserId: string, teamId: string): Promise<boolean> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    select: { workspace: { select: { ownerUserId: true } } },
  });
  return team.workspace.ownerUserId === callerUserId;
}

async function isTeamOwnerOrAdmin(callerUserId: string, teamId: string): Promise<boolean> {
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: callerUserId, teamId } },
    select: { role: true },
  });
  return !!membership && (membership.role === "OWNER" || membership.role === "ADMIN");
}

export async function assertCallerCanManageTeam(callerUserId: string, teamId: string): Promise<void> {
  if (await isWorkspaceOwnerOfTeam(callerUserId, teamId)) return;
  if (await isTeamOwnerOrAdmin(callerUserId, teamId)) return;
  throw new NotAuthorizedError(MANAGE_TEAM_ERROR);
}
