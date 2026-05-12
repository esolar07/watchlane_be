import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { CreateOrganizationBody, UpdateOrganizationBody } from "../types/organization";
import { assertWithinLimit } from "../services/entitlements.service";
import { NotAuthorizedError, ValidationError } from "../lib/errors";

const PLAN_SUMMARY_SELECT = { select: { slug: true, name: true } } as const;
const SETTINGS_SELECT = {
  select: {
    slaMinutes: true,
    slaEnabled: true,
    weeklyReportEnabled: true,
    weeklyReportDay: true,
    notifyOnBreach: true,
  },
} as const;

function validateSettingsInput(input: { slaMinutes?: number | null; weeklyReportDay?: number | null }): string | null {
  const { weeklyReportDay, slaMinutes } = input;
  if (weeklyReportDay !== undefined && weeklyReportDay !== null) {
    if (!Number.isInteger(weeklyReportDay) || weeklyReportDay < 0 || weeklyReportDay > 6) return "weeklyReportDay must be an integer between 0 (Sun) and 6 (Sat)";
  }
  if (slaMinutes !== undefined && slaMinutes !== null) {
    if (!Number.isInteger(slaMinutes) || slaMinutes < 1) return "slaMinutes must be a positive integer";
  }
  return null;
}

export async function listOrganizations(req: Request, res: Response) {
  const userId = req.user!.userId;
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          createdAt: true,
          workspaceId: true,
          workspace: { select: { name: true, currentPlan: PLAN_SUMMARY_SELECT } },
          settings: SETTINGS_SELECT,
          emailAccounts: { where: { userId }, select: { id: true }, take: 1 },
        },
      },
    },
  });

  res.json(
    memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      workspaceId: m.organization.workspaceId,
      workspaceName: m.organization.workspace.name,
      plan: m.organization.workspace.currentPlan,
      role: m.role,
      createdAt: m.organization.createdAt,
      mailboxConnected: m.organization.emailAccounts.length > 0,
      settings: m.organization.settings ?? null,
    }))
  );
}

export async function createOrganization(req: Request<{}, {}, CreateOrganizationBody>, res: Response) {
  if (!req.workspace) throw new NotAuthorizedError("Workspace context required");
  const { name, slaMinutes, slaEnabled, weeklyReportEnabled, weeklyReportDay, notifyOnBreach } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0) throw new ValidationError("Organization name is required");
  const settingsError = validateSettingsInput({ weeklyReportDay, slaMinutes });
  if (settingsError) throw new ValidationError(settingsError);

  const workspaceId = req.workspace.workspaceId;
  const userId = req.user!.userId;
  const currentOrgCount = await prisma.organization.count({ where: { workspaceId } });
  await assertWithinLimit(workspaceId, "org_limit", currentOrgCount);

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: name.trim(), workspaceId } });
    const member = await tx.organizationMember.create({ data: { userId, organizationId: org.id, role: "OWNER" } });
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
    workspaceId: result.org.workspaceId,
    role: result.member.role,
    inviteCode: result.org.inviteCode,
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
          workspace: { select: { id: true, name: true, currentPlan: PLAN_SUMMARY_SELECT } },
          settings: SETTINGS_SELECT,
          OrganizationMember: { include: { user: { select: { id: true, name: true, email: true } } } },
          emailAccounts: { select: { id: true, userId: true } },
        },
      },
    },
  });

  if (!membership) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const org = membership.organization;
  const isAdminOrOwner = membership.role === "OWNER" || membership.role === "ADMIN";
  res.json({
    id: org.id,
    name: org.name,
    workspaceId: org.workspace.id,
    workspaceName: org.workspace.name,
    plan: org.workspace.currentPlan,
    role: membership.role,
    createdAt: org.createdAt,
    ...(isAdminOrOwner && { inviteCode: org.inviteCode }),
    settings: org.settings ?? null,
    members: org.OrganizationMember.map((m) => ({
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      mailboxConnected: org.emailAccounts.some((ea) => ea.userId === m.user.id),
    })),
  });
}

export async function updateOrganization(req: Request<{ id: string }, {}, UpdateOrganizationBody>, res: Response) {
  const { id } = req.params;
  const userId = req.user!.userId;
  const { name, settings } = req.body;
  const { slaMinutes, slaEnabled, weeklyReportEnabled, weeklyReportDay, notifyOnBreach } = settings ?? {};

  const membership = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId: id } } });
  if (!membership) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    res.status(403).json({ error: "Only OWNER or ADMIN can update the organization" });
    return;
  }
  if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) throw new ValidationError("Organization name cannot be empty");
  const settingsError = validateSettingsInput({ weeklyReportDay, slaMinutes });
  if (settingsError) throw new ValidationError(settingsError);

  const hasSettingsUpdate = [slaMinutes, slaEnabled, weeklyReportEnabled, weeklyReportDay, notifyOnBreach].some((v) => v !== undefined);

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id },
      data: { ...(name !== undefined && { name: name.trim() }) },
      include: { workspace: { select: { currentPlan: PLAN_SUMMARY_SELECT } } },
    });
    let settingsRow = null;
    if (hasSettingsUpdate) {
      settingsRow = await tx.organizationSettings.upsert({
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
      settingsRow = await tx.organizationSettings.findUnique({ where: { organizationId: id } });
    }
    return { org, settings: settingsRow };
  });

  res.json({
    id: result.org.id,
    name: result.org.name,
    workspaceId: result.org.workspaceId,
    plan: result.org.workspace.currentPlan,
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

export async function regenerateInviteCode(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const userId = req.user!.userId;
  const membership = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId: id } } });
  if (!membership) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    res.status(403).json({ error: "Only OWNER or ADMIN can regenerate the invite code" });
    return;
  }
  const org = await prisma.organization.update({ where: { id }, data: { inviteCode: crypto.randomUUID() } });
  res.json({ inviteCode: org.inviteCode });
}
