import { prisma } from "../lib/prisma";

interface DashboardMetricsParams {
  organizationId: string;
  repId?: string;
  startDate: Date;
  endDate: Date;
}

interface RecentActivityItem {
  type: "breach" | "at_risk" | "covered" | "sync_success" | "sync_failed";
  message: string;
  threadId?: string;
  subject?: string | null;
  ownerName?: string | null;
  emailAddress?: string;
  minutesOverdue?: number;
  minutesRemaining?: number;
  responseMinutes?: number;
  timestamp: Date;
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
  recentActivity: RecentActivityItem[];
}

export async function getDashboardMetrics({
  organizationId,
  repId,
  startDate,
  endDate,
}: DashboardMetricsParams): Promise<DashboardMetrics> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
  });

  const slaTarget = settings?.slaMinutes ?? 560;
  const slaMs = slaTarget * 60_000;

  const [threads, emailAccounts] = await Promise.all([
    prisma.thread.findMany({
      where: {
        organizationId,
        firstInboundAt: { gte: startDate, lte: endDate },
        ...(repId && {
          emailAccount: { userId: repId },
        }),
      },
      select: {
        id: true,
        subject: true,
        firstInboundAt: true,
        firstOutboundAt: true,
        updatedAt: true,
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
        organizationId,
        ...(repId && { userId: repId }),
      },
      select: {
        emailAddress: true,
        lastSyncAt: true,
        tokenExpiresAt: true,
      },
    }),
  ]);

  const now = Date.now();
  let coveredWithinSla = 0;
  let breaches = 0;
  let atRisk = 0;
  let responseTimeSum = 0;
  let responseTimeCount = 0;
  let oldestUncoveredMs = 0;
  const recentActivity: RecentActivityItem[] = [];

  for (const thread of threads) {
    if (!thread.firstInboundAt) continue;

    const hasResponse = thread.firstOutboundAt !== null;
    const ownerName = thread.emailAccount.user.name;
    const label = thread.subject ?? "Untitled thread";

    if (hasResponse) {
      const responseMs =
        thread.firstOutboundAt!.getTime() - thread.firstInboundAt.getTime();
      const responseMin = Math.round(responseMs / 60_000);
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
          responseMinutes: responseMin,
          timestamp: thread.firstOutboundAt!,
        });
      } else {
        breaches++;
        const overdueMin = Math.round((responseMs - slaMs) / 60_000);
        recentActivity.push({
          type: "breach",
          message: `Thread '${label}' breached SLA${ownerName ? ` (Owner: ${ownerName})` : ""}`,
          threadId: thread.id,
          subject: thread.subject,
          ownerName,
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
          type: "breach",
          message: `Thread '${label}' is overdue by ${overdueMin} minutes`,
          threadId: thread.id,
          subject: thread.subject,
          ownerName,
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
          minutesRemaining: remainingMin,
          timestamp: thread.firstInboundAt,
        });
      }

      if (elapsedMs > oldestUncoveredMs) {
        oldestUncoveredMs = elapsedMs;
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

  // Sort: breaches first, then at_risk, then covered, then sync
  const typePriority = { breach: 0, at_risk: 1, covered: 2, sync_failed: 3, sync_success: 4 };
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
  const oldestUncoveredMinutes = Math.round(oldestUncoveredMs / 60_000);

  return {
    slaTarget,
    compliancePercent,
    totalInbound,
    coveredWithinSla,
    breaches,
    atRisk,
    avgResponseMinutes,
    oldestUncoveredMinutes,
    recentActivity,
  };
}
