import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { CreateTeamBody, UpdateTeamBody } from "../types/team";
import { assertWithinLimit } from "../services/entitlements.service";
import { NotAuthorizedError, ValidationError } from "../lib/errors";

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

export async function listTeams(req: Request, res: Response) {
  const userId = req.user!.userId;
  const memberships = await prisma.teamMember.findMany({
    where: { userId },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          createdAt: true,
          workspaceId: true,
          workspace: { select: { name: true } },
          settings: SETTINGS_SELECT,
          emailAccounts: { where: { userId }, select: { id: true }, take: 1 },
        },
      },
    },
  });

  res.json(
    memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      workspaceId: m.team.workspaceId,
      workspaceName: m.team.workspace.name,
      role: m.role,
      createdAt: m.team.createdAt,
      mailboxConnected: m.team.emailAccounts.length > 0,
      settings: m.team.settings ?? null,
    }))
  );
}

export async function createTeam(req: Request<{}, {}, CreateTeamBody>, res: Response) {
  if (!req.workspace) throw new NotAuthorizedError("Workspace context required");
  const { name, slaMinutes, slaEnabled, weeklyReportEnabled, weeklyReportDay, notifyOnBreach } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0) throw new ValidationError("Team name is required");
  const settingsError = validateSettingsInput({ weeklyReportDay, slaMinutes });
  if (settingsError) throw new ValidationError(settingsError);

  const workspaceId = req.workspace.workspaceId;
  const userId = req.user!.userId;
  const currentTeamCount = await prisma.team.count({ where: { workspaceId } });
  await assertWithinLimit(workspaceId, "team_limit", currentTeamCount);

  const result = await prisma.$transaction(async (tx) => {
    const team = await tx.team.create({ data: { name: name.trim(), workspaceId } });
    const member = await tx.teamMember.create({ data: { userId, teamId: team.id, role: "OWNER" } });
    const settings = await tx.teamSettings.create({
      data: {
        teamId: team.id,
        ...(slaMinutes !== undefined && { slaMinutes }),
        ...(slaEnabled !== undefined && { slaEnabled }),
        ...(weeklyReportEnabled !== undefined && { weeklyReportEnabled }),
        ...(weeklyReportDay !== undefined && { weeklyReportDay }),
        ...(notifyOnBreach !== undefined && { notifyOnBreach }),
      },
    });
    return { team, member, settings };
  });

  res.status(201).json({
    id: result.team.id,
    name: result.team.name,
    workspaceId: result.team.workspaceId,
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

export async function getTeam(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const userId = req.user!.userId;

  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId, teamId: id } },
    include: {
      team: {
        include: {
          workspace: { select: { id: true, name: true } },
          settings: SETTINGS_SELECT,
          members: { include: { user: { select: { id: true, name: true, email: true } } } },
          emailAccounts: { select: { id: true, userId: true } },
        },
      },
    },
  });

  if (!membership) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const team = membership.team;
  res.json({
    id: team.id,
    name: team.name,
    workspaceId: team.workspace.id,
    workspaceName: team.workspace.name,
    role: membership.role,
    createdAt: team.createdAt,
    settings: team.settings ?? null,
    members: team.members.map((m) => ({
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      mailboxConnected: team.emailAccounts.some((ea) => ea.userId === m.user.id),
    })),
  });
}

export async function updateTeam(req: Request<{ id: string }, {}, UpdateTeamBody>, res: Response) {
  const { id } = req.params;
  const userId = req.user!.userId;
  const { name, settings } = req.body;
  const { slaMinutes, slaEnabled, weeklyReportEnabled, weeklyReportDay, notifyOnBreach } = settings ?? {};

  const membership = await prisma.teamMember.findUnique({ where: { userId_teamId: { userId, teamId: id } } });
  if (!membership) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    res.status(403).json({ error: "Only OWNER or ADMIN can update the team" });
    return;
  }
  if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) throw new ValidationError("Team name cannot be empty");
  const settingsError = validateSettingsInput({ weeklyReportDay, slaMinutes });
  if (settingsError) throw new ValidationError(settingsError);

  const hasSettingsUpdate = [slaMinutes, slaEnabled, weeklyReportEnabled, weeklyReportDay, notifyOnBreach].some((v) => v !== undefined);

  const result = await prisma.$transaction(async (tx) => {
    const team = await tx.team.update({
      where: { id },
      data: { ...(name !== undefined && { name: name.trim() }) },
    });
    let settingsRow = null;
    if (hasSettingsUpdate) {
      settingsRow = await tx.teamSettings.upsert({
        where: { teamId: id },
        create: {
          teamId: id,
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
      settingsRow = await tx.teamSettings.findUnique({ where: { teamId: id } });
    }
    return { team, settings: settingsRow };
  });

  res.json({
    id: result.team.id,
    name: result.team.name,
    workspaceId: result.team.workspaceId,
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

