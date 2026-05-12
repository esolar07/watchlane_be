import { prisma } from "../lib/prisma";

export async function createOwnedWorkspace(userId: string, name: string): Promise<string> {
  const workspace = await prisma.workspace.create({ data: { name, ownerUserId: userId } });
  return workspace.id;
}
