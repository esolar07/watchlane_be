import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";

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
