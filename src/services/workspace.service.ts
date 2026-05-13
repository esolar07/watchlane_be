import { prisma } from "../lib/prisma";
import { sendOwnerWelcomeEmail } from "./email-notifications.service";

const DEFAULT_FIRST_TEAM_NAME = "General";

export async function createOwnedWorkspace(userId: string, name: string): Promise<string> {
  const workspace = await prisma.workspace.create({ data: { name, ownerUserId: userId } });
  void deliverOwnerWelcomeSafely(userId, name);
  return workspace.id;
}

async function deliverOwnerWelcomeSafely(userId: string, workspaceName: string): Promise<void> {
  try {
    await sendOwnerWelcomeEmail(userId, workspaceName);
  } catch (error) {
    console.error("[email] Failed to send owner welcome email", error);
  }
}

export async function ensureUserHasWorkspace(userId: string, fallbackName: string): Promise<string> {
  const owned = await prisma.workspace.findFirst({ where: { ownerUserId: userId }, select: { id: true } });
  if (owned) return owned.id;
  return createOwnedWorkspace(userId, fallbackName);
}

export async function ensureUserHasFirstTeam(userId: string, workspaceId: string): Promise<void> {
  const existing = await prisma.team.findFirst({ where: { workspaceId }, select: { id: true } });
  if (existing) return;
  await createFirstTeam(userId, workspaceId, DEFAULT_FIRST_TEAM_NAME);
}

async function createFirstTeam(userId: string, workspaceId: string, name: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const team = await tx.team.create({ data: { name, workspaceId } });
    await tx.teamSettings.create({ data: { teamId: team.id } });
    await tx.teamMember.create({ data: { userId, teamId: team.id, role: "OWNER" } });
  });
}

export function defaultWorkspaceName(userName: string | null | undefined, userEmail: string): string {
  const base = (userName ?? userEmail.split("@")[0]).trim();
  return `${base}'s Workspace`;
}
