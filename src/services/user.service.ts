import { prisma } from "../lib/prisma";

export async function findOrCreatePlaceholderUser(email: string): Promise<{ id: string }> {
  const normalized = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (existing) return existing;
  const freePlanId = await resolveFreePlanId();
  return prisma.user.create({ data: { email: normalized, currentPlanId: freePlanId }, select: { id: true } });
}

async function resolveFreePlanId(): Promise<string> {
  const free = await prisma.plan.findUniqueOrThrow({ where: { slug: "free" }, select: { id: true } });
  return free.id;
}
