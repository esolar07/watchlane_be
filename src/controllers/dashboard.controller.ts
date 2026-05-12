import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getDashboardMetrics } from "../services/dashboard.service";
import { getOperationalSnapshot } from "../services/dashboard-operational.service";
import { getPerformanceReport } from "../services/dashboard-performance.service";
import { getAggregateDashboard } from "../services/dashboard-aggregate.service";
import { getOrgDashboard } from "../services/dashboard-org.service";
import { syncUserMailboxes } from "../jobs/sync-mailboxes";

export async function getSummary(req: Request, res: Response) {
  const teamId = req.team!.teamId;

  const [coveredCount, uncoveredCount, uncoveredThreads, allThreads] =
    await Promise.all([
      prisma.thread.count({
        where: { teamId: teamId, coverageStatus: "COVERED" },
      }),
      prisma.thread.count({
        where: { teamId: teamId, coverageStatus: "UNCOVERED" },
      }),
      prisma.thread.findMany({
        where: { teamId: teamId, coverageStatus: "UNCOVERED" },
        select: { lastInboundAt: true },
      }),
      prisma.thread.findMany({
        where: {
          teamId: teamId,
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
  const { startDate, endDate, repId, teamId } = req.query;

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

  const memberships = await prisma.teamMember.findMany({
    where: { userId: req.user!.userId },
    include: { team: { select: { name: true } } },
  });

  if (memberships.length === 0) {
    res.status(403).json({ error: "User is not a member of any team" });
    return;
  }

  const selectedTeamId = teamId as string | undefined;

  if (selectedTeamId) {
    const isMember = memberships.some(
      (m) => m.teamId === selectedTeamId
    );
    if (!isMember) {
      res.status(403).json({ error: "User is not a member of the specified team" });
      return;
    }

    const org = memberships.find((m) => m.teamId === selectedTeamId)!;
    const metrics = await getDashboardMetrics({
      teamId: selectedTeamId,
      startDate: start,
      endDate: end,
      repId: repId as string | undefined,
    });

    res.json({
      teamId: org.teamId,
      teamName: org.team.name,
      ...metrics,
    });
    return;
  }

  const results = await Promise.all(
    memberships.map(async (m) => {
      const metrics = await getDashboardMetrics({
        teamId: m.teamId,
        startDate: start,
        endDate: end,
        repId: repId as string | undefined,
      });
      return {
        teamId: m.teamId,
        teamName: m.team.name,
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
  const snapshot = await getOperationalSnapshot({ teamId: req.team!.teamId, repId });
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
  const teamIds = await loadUserTeamIds(req.user.userId);
  if (teamIds.length === 0) {
    res.status(403).json({ error: "User is not a member of any team" });
    return;
  }
  const result = await getAggregateDashboard({ teamIds: teamIds, startDate: range.start!, endDate: range.end! });
  res.json(result);
}

async function loadUserTeamIds(userId: string): Promise<string[]> {
  const memberships = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true },
  });
  return memberships.map((m) => m.teamId);
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
  const dashboard = await getOrgDashboard({ teamId: req.team!.teamId, startDate: range.start!, endDate: range.end!, repId });
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
  const report = await getPerformanceReport({ teamId: req.team!.teamId, startDate: range.start!, endDate: range.end!, repId });
  res.json(report);
}

async function ensureOrgMembership(req: Request, res: Response): Promise<boolean> {
  if (!req.team) {
    res.status(403).json({ error: "Team context required" });
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
