import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getDashboardMetrics } from "../services/dashboard.service";
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
