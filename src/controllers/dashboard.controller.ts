import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getDashboardMetrics } from "../services/dashboard.service";
import { getOperationalSnapshot } from "../services/dashboard-operational.service";
import { getPerformanceReport } from "../services/dashboard-performance.service";
import { getAggregateDashboard } from "../services/dashboard-aggregate.service";
import { getOrgDashboard } from "../services/dashboard-org.service";
import { syncUserMailboxes } from "../jobs/sync-mailboxes";

export async function getSummary(req: Request, res: Response) {
  const orgId = req.org!.orgId;

  const [coveredCount, uncoveredCount, uncoveredThreads, allThreads] =
    await Promise.all([
      prisma.thread.count({
        where: { organizationId: orgId, coverageStatus: "COVERED" },
      }),
      prisma.thread.count({
        where: { organizationId: orgId, coverageStatus: "UNCOVERED" },
      }),
      prisma.thread.findMany({
        where: { organizationId: orgId, coverageStatus: "UNCOVERED" },
        select: { lastInboundAt: true },
      }),
      prisma.thread.findMany({
        where: {
          organizationId: orgId,
          lastInboundAt: { not: null },
          lastOutboundAt: { not: null },
        },
        select: { lastInboundAt: true, lastOutboundAt: true },
      }),
    ]);

  const responseTimes = allThreads
    .filter((t) => t.lastOutboundAt! > t.lastInboundAt!)
    .map(
      (t) => t.lastOutboundAt!.getTime() - t.lastInboundAt!.getTime()
    );

  const avgResponseTimeMinutes =
    responseTimes.length > 0
      ? Math.round(
          responseTimes.reduce((sum, ms) => sum + ms, 0) /
            responseTimes.length /
            60000
        )
      : 0;

  const now = Date.now();
  const oldestUncoveredMinutes =
    uncoveredThreads.length > 0
      ? Math.round(
          Math.max(
            ...uncoveredThreads
              .filter((t) => t.lastInboundAt !== null)
              .map((t) => now - t.lastInboundAt!.getTime())
          ) / 60000
        )
      : 0;

  res.json({
    coveredCount,
    uncoveredCount,
    avgResponseTimeMinutes,
    oldestUncoveredMinutes,
  });
}

export async function getCoverageMetrics(req: Request, res: Response) {
  const { startDate, endDate, repId, orgId } = req.query;

  if (!startDate || !endDate) {
    res.status(400).json({ error: "startDate and endDate are required" });
    return;
  }

  const start = new Date(startDate as string);
  const end = new Date(endDate as string);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    res.status(400).json({ error: "Invalid date format" });
    return;
  }

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: req.user!.userId },
    include: { organization: { select: { name: true } } },
  });

  if (memberships.length === 0) {
    res.status(403).json({ error: "User is not a member of any organization" });
    return;
  }

  const selectedOrgId = orgId as string | undefined;

  if (selectedOrgId) {
    const isMember = memberships.some(
      (m) => m.organizationId === selectedOrgId
    );
    if (!isMember) {
      res.status(403).json({ error: "User is not a member of the specified organization" });
      return;
    }

    const org = memberships.find((m) => m.organizationId === selectedOrgId)!;
    const metrics = await getDashboardMetrics({
      organizationId: selectedOrgId,
      startDate: start,
      endDate: end,
      repId: repId as string | undefined,
    });

    res.json({
      organizationId: org.organizationId,
      organizationName: org.organization.name,
      ...metrics,
    });
    return;
  }

  const results = await Promise.all(
    memberships.map(async (m) => {
      const metrics = await getDashboardMetrics({
        organizationId: m.organizationId,
        startDate: start,
        endDate: end,
        repId: repId as string | undefined,
      });
      return {
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        ...metrics,
      };
    })
  );

  res.json(results);
}

export async function triggerSync(req: Request, res: Response) {
  try {
    await syncUserMailboxes(req.user!.userId);
    res.json({ message: "Sync completed successfully" });
  } catch (err) {
    res.status(500).json({ error: "Sync failed" });
  }
}

export async function getOperational(req: Request, res: Response) {
  const orgError = await ensureOrgMembership(req, res);
  if (orgError) return;
  const repId = req.query.repId as string | undefined;
  const snapshot = await getOperationalSnapshot({ organizationId: req.org!.orgId, repId });
  res.json(snapshot);
}

export async function getAggregate(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const range = parseDateRange(req);
  if (range.error) {
    res.status(400).json({ error: range.error });
    return;
  }
  const orgIds = await loadUserOrgIds(req.user.userId);
  if (orgIds.length === 0) {
    res.status(403).json({ error: "User is not a member of any organization" });
    return;
  }
  const result = await getAggregateDashboard({ organizationIds: orgIds, startDate: range.start!, endDate: range.end! });
  res.json(result);
}

async function loadUserOrgIds(userId: string): Promise<string[]> {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    select: { organizationId: true },
  });
  return memberships.map((m) => m.organizationId);
}

export async function getOrgDashboardEndpoint(req: Request, res: Response) {
  const orgError = await ensureOrgMembership(req, res);
  if (orgError) return;
  const range = parseDateRange(req);
  if (range.error) {
    res.status(400).json({ error: range.error });
    return;
  }
  const repId = req.query.repId as string | undefined;
  const dashboard = await getOrgDashboard({ organizationId: req.org!.orgId, startDate: range.start!, endDate: range.end!, repId });
  res.json(dashboard);
}

export async function getPerformance(req: Request, res: Response) {
  const orgError = await ensureOrgMembership(req, res);
  if (orgError) return;
  const range = parseDateRange(req);
  if (range.error) {
    res.status(400).json({ error: range.error });
    return;
  }
  const repId = req.query.repId as string | undefined;
  const report = await getPerformanceReport({ organizationId: req.org!.orgId, startDate: range.start!, endDate: range.end!, repId });
  res.json(report);
}

async function ensureOrgMembership(req: Request, res: Response): Promise<boolean> {
  if (!req.org) {
    res.status(403).json({ error: "Organization context required" });
    return true;
  }
  return false;
}

function parseDateRange(req: Request): { start?: Date; end?: Date; error?: string } {
  const startRaw = req.query.startDate as string | undefined;
  const endRaw = req.query.endDate as string | undefined;
  if (!startRaw || !endRaw) return { error: "startDate and endDate are required" };
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return { error: "Invalid date format" };
  return { start, end };
}
