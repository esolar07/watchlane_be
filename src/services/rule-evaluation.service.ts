import { prisma } from "../lib/prisma";
import type { EvaluationType, MonitoringRule } from "../generated/prisma/client";

export async function selectRuleForThread(
  threadId: string,
  evaluationType: EvaluationType
): Promise<MonitoringRule | null> {
  const thread = await prisma.thread.findUniqueOrThrow({ where: { id: threadId } });
  const folderRule = await pickFolderScopedRule(thread.teamId, thread.emailAccountId, thread.folderIds, evaluationType);
  if (folderRule) return folderRule;
  const accountRule = await pickAccountScopedRule(thread.teamId, thread.emailAccountId, evaluationType);
  if (accountRule) return accountRule;
  return pickTeamScopedRule(thread.teamId, evaluationType);
}

async function pickFolderScopedRule(
  teamId: string,
  emailAccountId: string,
  folderIds: string[],
  evaluationType: EvaluationType
): Promise<MonitoringRule | null> {
  if (folderIds.length === 0) return null;
  return prisma.monitoringRule.findFirst({
    where: { teamId, active: true, scopeKind: "FOLDER", emailAccountId, evaluationType, folderId: { in: folderIds } },
    orderBy: { createdAt: "asc" },
  });
}

async function pickAccountScopedRule(
  teamId: string,
  emailAccountId: string,
  evaluationType: EvaluationType
): Promise<MonitoringRule | null> {
  return prisma.monitoringRule.findFirst({
    where: { teamId, active: true, scopeKind: "ACCOUNT", emailAccountId, evaluationType },
    orderBy: { createdAt: "asc" },
  });
}

async function pickTeamScopedRule(
  teamId: string,
  evaluationType: EvaluationType
): Promise<MonitoringRule | null> {
  return prisma.monitoringRule.findFirst({
    where: { teamId, active: true, scopeKind: "TEAM", evaluationType },
    orderBy: { createdAt: "asc" },
  });
}
