import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export async function listOrganizations(req: Request, res: Response) {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId: req.user!.userId },
    include: {
      organization: {
        select: { id: true, name: true, planTier: true, createdAt: true },
      },
    },
  });

  res.json(
    memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      planTier: m.organization.planTier,
      role: m.role,
      createdAt: m.organization.createdAt,
    }))
  );
}

export async function createOrganization(req: Request, res: Response) {
  const { name } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Organization name is required" });
    return;
  }

  const userId = req.user!.userId;

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: name.trim() },
    });
    const member = await tx.organizationMember.create({
      data: {
        userId,
        organizationId: org.id,
        role: "OWNER",
      },
    });
    return { org, member };
  });

  res.status(201).json({
    id: result.org.id,
    name: result.org.name,
    role: result.member.role,
  });
}
