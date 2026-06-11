import { prisma } from "../lib/prisma";
import { resolveMailboxOwnerName } from "../lib/mailbox-owner";

interface DashboardMetricsParams {
  teamId: string;
  repId?: string;
  startDate: Date;
  endDate: Date;
}

interface RecentActivityItem {
  type: "late_response" | "overdue" | "at_risk" | "covered" | "sync_success" | "sync_failed";
  message: string;
  threadId?: string;
  subject?: string | null;
  ownerName?: string | null;
  emailAddress?: string;
  folderPath?: string | null;
  minutesOverdue?: number;
  minutesRemaining?: number;
  responseMinutes?: number;
  timestamp: Date;
}

interface OpenThread {
  threadId: string;
  subject: string | null;
  ownerName: string | null;
  emailAddress: string;
  folderPath: string | null;
  lastInboundAt: Date;
  minutesWaiting: number;
  isPastSla: boolean;
  isAtRisk: boolean;
}

interface DashboardMetrics {
  slaTarget: number;
  compliancePercent: number;
  totalInbound: number;
  coveredWithinSla: number;
  breaches: number;
  atRisk: number;
  avgResponseMinutes: number;
  oldestUncoveredMinutes: number;
  openCount: number;
  overdueCount: number;
  openThreads: OpenThread[];
  recentActivity: RecentActivityItem[];
}

export async function getDashboardMetrics({
  teamId,
  repId,
  startDate,
  endDate,
}: DashboardMetricsParams): Promise<DashboardMetrics> {
  const settings = await prisma.teamSettings.findUnique({
    where: { teamId },
  });

  const slaTarget = settings?.slaMinutes ?? 560;
  const slaMs = slaTarget * 60_000;

  const [threads, emailAccounts] = await Promise.all([
    prisma.thread.findMany({
      where: {
        teamId,
        firstInboundAt: { gte: startDate, lte: endDate },
        dismissedAt: null,
        ...(repId && {
          emailAccount: { userId: repId },
        }),
      },
      select: {
        id: true,
        subject: true,
        firstInboundAt: true,
        firstOutboundAt: true,
        firstResponseMinutes: true,
        updatedAt: true,
        folderIds: true,
        emailAccount: {
          select: {
            emailAddress: true,
            user: { select: { name: true } },
          },
        },
      },
      orderBy: { firstInboundAt: "desc" },
    }),
    prisma.emailAccount.findMany({
      where: {
        teamId,
        ...(repId && { userId: repId }),
      },
      select: {
        emailAddress: true,
        lastSyncAt: true,
        tokenExpiresAt: true,
      },
    }),
  ]);

  const folderPathsById = await loadFolderPathMap(threads);

  const now = Date.now();
  let coveredWithinSla = 0;
  let breaches = 0;
  let atRisk = 0;
  let responseTimeSum = 0;
  let responseTimeCount = 0;
  const recentActivity: RecentActivityItem[] = [];

  for (const thread of threads) {
    if (!thread.firstInboundAt) continue;

    const ownerName = resolveMailboxOwnerName(thread.emailAccount.user);
    const label = thread.subject ?? "Untitled thread";
    const folderPath = pickPrimaryFolderPath(thread.folderIds, folderPathsById);
    const hasValidResponse = thread.firstResponseMinutes !== null && thread.firstResponseMinutes >= 0;

    if (hasValidResponse) {
      const responseMin = thread.firstResponseMinutes!;
      const responseMs = responseMin * 60_000;
      responseTimeSum += responseMs;
      responseTimeCount++;

      if (responseMs <= slaMs) {
        coveredWithinSla++;
        recentActivity.push({
          type: "covered",
          message: `Thread '${label}' responded in ${responseMin} minutes`,
          threadId: thread.id,
          subject: thread.subject,
          ownerName,
          folderPath,
          responseMinutes: responseMin,
          timestamp: thread.firstOutboundAt!,
        });
      } else {
        breaches++;
        const overdueMin = Math.round((responseMs - slaMs) / 60_000);
        recentActivity.push({
          type: "late_response",
          message: `Thread '${label}' was responded ${overdueMin} minutes past SLA${ownerName ? ` (Owner: ${ownerName})` : ""}`,
          threadId: thread.id,
          subject: thread.subject,
          ownerName,
          folderPath,
          minutesOverdue: overdueMin,
          timestamp: thread.firstOutboundAt!,
        });
      }
    } else {
      const elapsedMs = now - thread.firstInboundAt.getTime();

      if (elapsedMs > slaMs) {
        breaches++;
        const overdueMin = Math.round((elapsedMs - slaMs) / 60_000);
        recentActivity.push({
          type: "overdue",
          message: `Thread '${label}' is overdue by ${overdueMin} minutes`,
          threadId: thread.id,
          subject: thread.subject,
          ownerName,
          folderPath,
          minutesOverdue: overdueMin,
          timestamp: thread.firstInboundAt,
        });
      } else if (elapsedMs >= slaMs * 0.8) {
        atRisk++;
        const remainingMin = Math.round((slaMs - elapsedMs) / 60_000);
        recentActivity.push({
          type: "at_risk",
          message: `Thread '${label}' has ${remainingMin} minutes before SLA breach`,
          threadId: thread.id,
          subject: thread.subject,
          ownerName,
          folderPath,
          minutesRemaining: remainingMin,
          timestamp: thread.firstInboundAt,
        });
      }
    }
  }

  // Mailbox sync activity
  for (const account of emailAccounts) {
    if (account.lastSyncAt) {
      const tokenExpired =
        account.tokenExpiresAt && account.tokenExpiresAt.getTime() < now;
      if (tokenExpired) {
        recentActivity.push({
          type: "sync_failed",
          message: `Mailbox ${account.emailAddress} sync failed — token refresh required`,
          emailAddress: account.emailAddress,
          timestamp: account.lastSyncAt,
        });
      } else {
        recentActivity.push({
          type: "sync_success",
          message: `Mailbox ${account.emailAddress} synced successfully`,
          emailAddress: account.emailAddress,
          timestamp: account.lastSyncAt,
        });
      }
    }
  }

  const typePriority = { overdue: 0, at_risk: 1, late_response: 2, covered: 3, sync_failed: 4, sync_success: 5 };
  recentActivity.sort(
    (a, b) =>
      typePriority[a.type] - typePriority[b.type] ||
      b.timestamp.getTime() - a.timestamp.getTime()
  );

  const totalInbound = threads.length;
  const compliancePercent =
    totalInbound > 0
      ? Math.round((coveredWithinSla / totalInbound) * 10000) / 100
      : 0;
  const avgResponseMinutes =
    responseTimeCount > 0
      ? Math.round(responseTimeSum / responseTimeCount / 60_000)
      : 0;
  const openThreads = await loadOpenThreads(teamId, slaTarget, repId);
  const overdueCount = openThreads.filter((t) => t.isPastSla).length;
  const oldestUncoveredMinutes = openThreads.length > 0 ? Math.max(...openThreads.map((t) => t.minutesWaiting)) : 0;

  return {
    slaTarget,
    compliancePercent,
    totalInbound,
    coveredWithinSla,
    breaches,
    atRisk,
    avgResponseMinutes,
    oldestUncoveredMinutes,
    openCount: openThreads.length,
    overdueCount,
    openThreads,
    recentActivity,
  };
}

async function loadOpenThreads(teamId: string, slaMin: number, repId?: string): Promise<OpenThread[]> {
  const slaMs = slaMin * 60_000;
  const threads = await prisma.thread.findMany({
    where: {
      teamId,
      coverageStatus: "UNCOVERED",
      lastInboundAt: { not: null },
      dismissedAt: null,
      ...(repId && { emailAccount: { userId: repId } }),
    },
    select: {
      id: true,
      subject: true,
      lastInboundAt: true,
      folderIds: true,
      emailAccount: { select: { emailAddress: true, user: { select: { name: true } } } },
    },
    orderBy: { lastInboundAt: "asc" },
  });
  const folderPathMap = await loadFolderPathMap(threads.map((t) => ({ folderIds: t.folderIds })));
  return threads.map((t) => buildOpenThread(t, folderPathMap, slaMs));
}

function buildOpenThread(
  thread: {
    id: string;
    subject: string | null;
    lastInboundAt: Date | null;
    folderIds: string[];
    emailAccount: { emailAddress: string; user: { name: string | null } | null };
  },
  folderPathMap: Map<string, string>,
  slaMs: number
): OpenThread {
  const lastInboundAt = thread.lastInboundAt!;
  const minutesWaiting = Math.round((Date.now() - lastInboundAt.getTime()) / 60_000);
  const elapsedMs = Date.now() - lastInboundAt.getTime();
  return {
    threadId: thread.id,
    subject: thread.subject,
    ownerName: resolveMailboxOwnerName(thread.emailAccount.user),
    emailAddress: thread.emailAccount.emailAddress,
    folderPath: pickPrimaryFolderPath(thread.folderIds, folderPathMap),
    lastInboundAt,
    minutesWaiting,
    isPastSla: elapsedMs > slaMs,
    isAtRisk: elapsedMs >= slaMs * 0.8 && elapsedMs <= slaMs,
  };
}

async function loadFolderPathMap(threads: { folderIds: string[] }[]): Promise<Map<string, string>> {
  const allFolderIds = collectUniqueFolderIds(threads);
  if (allFolderIds.length === 0) return new Map();
  const folders = await prisma.emailFolder.findMany({
    where: { id: { in: allFolderIds } },
    select: { id: true, path: true },
  });
  return new Map(folders.map((f) => [f.id, f.path]));
}

function collectUniqueFolderIds(threads: { folderIds: string[] }[]): string[] {
  const set = new Set<string>();
  for (const t of threads) for (const id of t.folderIds) set.add(id);
  return Array.from(set);
}

function pickPrimaryFolderPath(folderIds: string[], pathsById: Map<string, string>): string | null {
  if (folderIds.length === 0) return null;
  const paths = folderIds.map((id) => pathsById.get(id)).filter((p): p is string => Boolean(p));
  if (paths.length === 0) return null;
  return paths.sort()[0];
}
