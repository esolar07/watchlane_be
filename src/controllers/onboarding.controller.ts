import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ValidationError } from "../lib/errors";
import { assertWithinLimitForUser } from "../services/entitlements.service";

interface OnboardingBody {
  workspaceName?: string;
  teamName?: string;
  profileName?: string;
}

export async function completeOnboarding(req: Request<{}, {}, OnboardingBody>, res: Response) {
  const userId = req.user!.userId;
  const { workspaceName, teamName, profileName } = validateOnboardingBody(req.body);
  await enforceWorkspaceLimit(userId);
  const result = await prisma.$transaction((tx) => provisionOnboarding(tx, userId, workspaceName, teamName, profileName));
  res.status(201).json(result);
}

function validateOnboardingBody(raw: OnboardingBody | undefined) {
  const workspaceName = raw?.workspaceName?.trim();
  const teamName = raw?.teamName?.trim();
  if (!workspaceName) throw new ValidationError("workspaceName is required");
  if (!teamName) throw new ValidationError("teamName is required");
  return { workspaceName, teamName, profileName: raw?.profileName?.trim() };
}

async function enforceWorkspaceLimit(userId: string): Promise<void> {
  const current = await prisma.workspace.count({ where: { ownerUserId: userId } });
  await assertWithinLimitForUser(userId, "workspace_limit", current);
}

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function provisionOnboarding(tx: TransactionClient, userId: string, workspaceName: string, teamName: string, profileName: string | undefined) {
  if (profileName) await tx.user.update({ where: { id: userId }, data: { name: profileName } });
  const workspace = await tx.workspace.create({ data: { name: workspaceName, ownerUserId: userId } });
  const team = await tx.team.create({ data: { name: teamName, workspaceId: workspace.id } });
  await tx.teamSettings.create({ data: { teamId: team.id } });
  await tx.teamMember.create({ data: { userId, teamId: team.id, role: "OWNER" } });
  const user = await tx.user.update({ where: { id: userId }, data: { onboardingCompletedAt: new Date() }, select: { id: true, email: true, name: true, onboardingCompletedAt: true } });
  return { user, workspace, team };
}
