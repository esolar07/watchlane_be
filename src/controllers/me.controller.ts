import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ValidationError } from "../lib/errors";

interface UpdateMeBody {
  name?: string;
}

const ME_SELECT = {
  id: true,
  email: true,
  name: true,
  onboardingCompletedAt: true,
  currentPlan: { select: { slug: true, name: true } },
} as const;

export async function getMe(req: Request, res: Response) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId }, select: ME_SELECT });
  res.json(user);
}

export async function updateMe(req: Request<{}, {}, UpdateMeBody>, res: Response) {
  const name = req.body?.name?.trim();
  if (!name) throw new ValidationError("name is required");
  const user = await prisma.user.update({ where: { id: req.user!.userId }, data: { name }, select: ME_SELECT });
  res.json(user);
}
