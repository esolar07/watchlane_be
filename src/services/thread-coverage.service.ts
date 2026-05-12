import { prisma } from "../lib/prisma";
import type { MessageDirection } from "../generated/prisma/client";

interface CoverageStamps {
  firstInboundAt: Date | null;
  firstOutboundAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
}

const DEFAULT_SLA_MINUTES = 560;

export async function recomputeThreadCoverage(threadId: string): Promise<void> {
  const messages = await prisma.message.findMany({
    where: { threadId },
    select: { direction: true, sentAt: true },
    orderBy: { sentAt: "asc" },
  });
  const stamps = computeCoverageStamps(messages);
  const coverageStatus = computeCoverageStatus(stamps.lastInboundAt, stamps.lastOutboundAt);
  const firstResponseMinutes = computeFirstResponseMinutes(stamps);
  const hadLateFirstResponse = await computeHadLateFirstResponse(threadId, firstResponseMinutes);
  await prisma.thread.update({ where: { id: threadId }, data: { ...stamps, coverageStatus, firstResponseMinutes, hadLateFirstResponse } });
}

function computeCoverageStamps(messages: { direction: MessageDirection; sentAt: Date }[]): CoverageStamps {
  const stamps: CoverageStamps = { firstInboundAt: null, firstOutboundAt: null, lastInboundAt: null, lastOutboundAt: null };
  for (const message of messages) updateStampsForMessage(stamps, message);
  return stamps;
}

function updateStampsForMessage(stamps: CoverageStamps, message: { direction: MessageDirection; sentAt: Date }): void {
  if (message.direction === "INBOUND") {
    stamps.firstInboundAt ??= message.sentAt;
    stamps.lastInboundAt = message.sentAt;
    return;
  }
  stamps.firstOutboundAt ??= message.sentAt;
  stamps.lastOutboundAt = message.sentAt;
}

function computeCoverageStatus(lastInbound: Date | null, lastOutbound: Date | null): "COVERED" | "UNCOVERED" {
  if (!lastInbound) return "COVERED";
  if (!lastOutbound) return "UNCOVERED";
  return lastOutbound > lastInbound ? "COVERED" : "UNCOVERED";
}

function computeFirstResponseMinutes(stamps: CoverageStamps): number | null {
  if (!stamps.firstInboundAt || !stamps.firstOutboundAt) return null;
  if (stamps.firstOutboundAt <= stamps.firstInboundAt) return null;
  const diffMs = stamps.firstOutboundAt.getTime() - stamps.firstInboundAt.getTime();
  return Math.round(diffMs / 60_000);
}

async function computeHadLateFirstResponse(threadId: string, firstResponseMinutes: number | null): Promise<boolean> {
  if (firstResponseMinutes === null) return false;
  const slaMinutes = await loadSlaMinutesForThread(threadId);
  return firstResponseMinutes > slaMinutes;
}

async function loadSlaMinutesForThread(threadId: string): Promise<number> {
  const row = await prisma.thread.findUnique({
    where: { id: threadId },
    select: { team: { select: { settings: { select: { slaMinutes: true } } } } },
  });
  return row?.team.settings?.slaMinutes ?? DEFAULT_SLA_MINUTES;
}
