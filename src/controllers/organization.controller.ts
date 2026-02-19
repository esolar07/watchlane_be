import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { CreateOrganizationBody, UpdateOrganizationBody } from "../types/organization";

export async function listOrganizations(req: Request, res: Response) {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId: req.user!.userId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          planTier: true,
          createdAt: true,
          settings: {
            select: {
              slaMinutes: true,
              slaEnabled: true,
              weeklyReportEnabled: true,
              weeklyReportDay: true,
              notifyOnBreach: true,
            },
          },
        },
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
      settings: m.organization.settings ?? null,
    }))
  );
}

export async function createOrganization(req: Request<{}, {}, CreateOrganizationBody>, res: Response) {
  const { name, slaMinutes, slaEnabled, weeklyReportEnabled, weeklyReportDay, notifyOnBreach } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Organization name is required" });
    return;
  }

  if (weeklyReportDay !== undefined && weeklyReportDay !== null) {
    if (!Number.isInteger(weeklyReportDay) || weeklyReportDay < 0 || weeklyReportDay > 6) {
      res.status(400).json({ error: "weeklyReportDay must be an integer between 0 (Sun) and 6 (Sat)" });
      return;
    }
  }

  if (slaMinutes !== undefined && slaMinutes !== null) {
    if (!Number.isInteger(slaMinutes) || slaMinutes < 1) {
      res.status(400).json({ error: "slaMinutes must be a positive integer" });
      return;
    }
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
    const settings = await tx.organizationSettings.create({
      data: {
        organizationId: org.id,
        ...(slaMinutes !== undefined && { slaMinutes }),
        ...(slaEnabled !== undefined && { slaEnabled }),
        ...(weeklyReportEnabled !== undefined && { weeklyReportEnabled }),
        ...(weeklyReportDay !== undefined && { weeklyReportDay }),
        ...(notifyOnBreach !== undefined && { notifyOnBreach }),
      },
    });
    return { org, member, settings };
  });

  res.status(201).json({
    id: result.org.id,
    name: result.org.name,
    role: result.member.role,
    settings: {
      slaMinutes: result.settings.slaMinutes,
      slaEnabled: result.settings.slaEnabled,
      weeklyReportEnabled: result.settings.weeklyReportEnabled,
      weeklyReportDay: result.settings.weeklyReportDay,
      notifyOnBreach: result.settings.notifyOnBreach,
    },
  });
}

export async function getOrganization(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const userId = req.user!.userId;

  const membership = await prisma.organizationMember.findUnique({
    where: { userId_organizationId: { userId, organizationId: id } },
    include: {
      organization: {
        include: {
          settings: {
            select: {
              slaMinutes: true,
              slaEnabled: true,
              weeklyReportEnabled: true,
              weeklyReportDay: true,
              notifyOnBreach: true,
            },
          },
        },
      },
    },
  });

  if (!membership) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const org = membership.organization;
  res.json({
    id: org.id,
    name: org.name,
    planTier: org.planTier,
    role: membership.role,
    createdAt: org.createdAt,
    settings: org.settings ?? null,
  });
}

export async function updateOrganization(req: Request<{ id: string }, {}, UpdateOrganizationBody>, res: Response) {
  const { id } = req.params;
  const userId = req.user!.userId;
  const { name, slaMinutes, slaEnabled, weeklyReportEnabled, weeklyReportDay, notifyOnBreach } = req.body;

  const membership = await prisma.organizationMember.findUnique({
    where: { userId_organizationId: { userId, organizationId: id } },
  });

  if (!membership) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    res.status(403).json({ error: "Only OWNER or ADMIN can update the organization" });
    return;
  }

  if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
    res.status(400).json({ error: "Organization name cannot be empty" });
    return;
  }

  if (weeklyReportDay !== undefined && weeklyReportDay !== null) {
    if (!Number.isInteger(weeklyReportDay) || weeklyReportDay < 0 || weeklyReportDay > 6) {
      res.status(400).json({ error: "weeklyReportDay must be an integer between 0 (Sun) and 6 (Sat)" });
      return;
    }
  }

  if (slaMinutes !== undefined && slaMinutes !== null) {
    if (!Number.isInteger(slaMinutes) || slaMinutes < 1) {
      res.status(400).json({ error: "slaMinutes must be a positive integer" });
      return;
    }
  }

  const hasSettingsUpdate = [slaMinutes, slaEnabled, weeklyReportEnabled, weeklyReportDay, notifyOnBreach].some(
    (v) => v !== undefined
  );

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
      },
    });

    let settings = null;
    if (hasSettingsUpdate) {
      settings = await tx.organizationSettings.upsert({
        where: { organizationId: id },
        create: {
          organizationId: id,
          ...(slaMinutes !== undefined && { slaMinutes }),
          ...(slaEnabled !== undefined && { slaEnabled }),
          ...(weeklyReportEnabled !== undefined && { weeklyReportEnabled }),
          ...(weeklyReportDay !== undefined && { weeklyReportDay }),
          ...(notifyOnBreach !== undefined && { notifyOnBreach }),
        },
        update: {
          ...(slaMinutes !== undefined && { slaMinutes }),
          ...(slaEnabled !== undefined && { slaEnabled }),
          ...(weeklyReportEnabled !== undefined && { weeklyReportEnabled }),
          ...(weeklyReportDay !== undefined && { weeklyReportDay }),
          ...(notifyOnBreach !== undefined && { notifyOnBreach }),
        },
      });
    } else {
      settings = await tx.organizationSettings.findUnique({
        where: { organizationId: id },
      });
    }

    return { org, settings };
  });

  res.json({
    id: result.org.id,
    name: result.org.name,
    planTier: result.org.planTier,
    settings: result.settings
      ? {
          slaMinutes: result.settings.slaMinutes,
          slaEnabled: result.settings.slaEnabled,
          weeklyReportEnabled: result.settings.weeklyReportEnabled,
          weeklyReportDay: result.settings.weeklyReportDay,
          notifyOnBreach: result.settings.notifyOnBreach,
        }
      : null,
  });
}
