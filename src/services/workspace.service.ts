import { prisma } from "../lib/prisma";

export async function ensureUserHasWorkspace(userId: string, fallbackName: string): Promise<string> {
  const existing = await prisma.workspaceMember.findFirst({ where: { userId }, select: { workspaceId: true } });
  if (existing) return existing.workspaceId;
  return createOwnedWorkspace(userId, fallbackName);
}

export async function createOwnedWorkspace(userId: string, name: string): Promise<string> {
  const freePlan = await prisma.plan.findUniqueOrThrow({ where: { slug: "free" }, select: { id: true } });
  const workspace = await prisma.workspace.create({ data: { name, currentPlanId: freePlan.id } });
  await prisma.workspaceMember.create({ data: { userId, workspaceId: workspace.id, role: "OWNER" } });
  return workspace.id;
}

export function defaultWorkspaceName(userName: string | null | undefined, userEmail: string): string {
  const base = (userName ?? userEmail.split("@")[0]).trim();
  return `${base}'s Workspace`;
}
