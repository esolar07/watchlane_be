import { prisma } from "../lib/prisma";
import type { EvaluationType, MonitoringRule } from "../generated/prisma/client";

export async function selectRuleForThread(
  threadId: string,
  evaluationType: EvaluationType
): Promise<MonitoringRule | null> {
  const thread = await prisma.thread.findUniqueOrThrow({ where: { id: threadId } });
  const folderRule = await pickFolderScopedRule(thread.organizationId, thread.emailAccountId, thread.folderIds, evaluationType);
  if (folderRule) return folderRule;
  const accountRule = await pickAccountScopedRule(thread.organizationId, thread.emailAccountId, evaluationType);
  if (accountRule) return accountRule;
  return pickOrganizationScopedRule(thread.organizationId, evaluationType);
}

async function pickFolderScopedRule(
  organizationId: string,
  emailAccountId: string,
  folderIds: string[],
  evaluationType: EvaluationType
): Promise<MonitoringRule | null> {
  if (folderIds.length === 0) return null;
  return prisma.monitoringRule.findFirst({
    where: { organizationId, active: true, scopeKind: "FOLDER", emailAccountId, evaluationType, folderId: { in: folderIds } },
    orderBy: { createdAt: "asc" },
  });
}

async function pickAccountScopedRule(
  organizationId: string,
  emailAccountId: string,
  evaluationType: EvaluationType
): Promise<MonitoringRule | null> {
  return prisma.monitoringRule.findFirst({
    where: { organizationId, active: true, scopeKind: "ACCOUNT", emailAccountId, evaluationType },
    orderBy: { createdAt: "asc" },
  });
}

async function pickOrganizationScopedRule(
  organizationId: string,
  evaluationType: EvaluationType
): Promise<MonitoringRule | null> {
  return prisma.monitoringRule.findFirst({
    where: { organizationId, active: true, scopeKind: "ORGANIZATION", evaluationType },
    orderBy: { createdAt: "asc" },
  });
}
