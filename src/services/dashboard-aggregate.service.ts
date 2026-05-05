import { prisma } from "../lib/prisma";

const DEFAULT_SLA_MINUTES = 560;

interface ImpactedOrg {
  organizationId: string;
  organizationName: string;
  overdueCount: number;
}

interface AggregateDashboard {
  windowStart: Date;
  windowEnd: Date;
  totalOrgs: number;
  impactedOrgs: ImpactedOrg[];
  totalOpenThreads: number;
  totalOverdue: number;
  totalAtRisk: number;
  totalOnTrack: number;
  avgResponseMinutes: number;
  avgResponseFormatted: string;
  oldestGapMinutes: number;
  oldestGapFormatted: string;
  slaCompliancePercent: number;
}

interface AggregateParams {
  organizationIds: string[];
  startDate: Date;
  endDate: Date;
}

export async function getAggregateDashboard(params: AggregateParams): Promise<AggregateDashboard> {
  const snapshot = await computeOpenSnapshot(params.organizationIds);
  const historical = await computeHistoricalCompliance(params);
  return assembleAggregate(params, snapshot, historical);
}

function assembleAggregate(
  params: AggregateParams,
  snapshot: { open: number; overdue: number; atRisk: number; onTrack: number; oldestGapMinutes: number; impactedOrgs: ImpactedOrg[] },
  historical: { avgResponseMinutes: number; slaCompliancePercent: number }
): AggregateDashboard {
  return {
    windowStart: params.startDate,
    windowEnd: params.endDate,
    totalOrgs: params.organizationIds.length,
    impactedOrgs: snapshot.impactedOrgs,
    totalOpenThreads: snapshot.open,
    totalOverdue: snapshot.overdue,
    totalAtRisk: snapshot.atRisk,
    totalOnTrack: snapshot.onTrack,
    avgResponseMinutes: historical.avgResponseMinutes,
    avgResponseFormatted: formatDuration(historical.avgResponseMinutes),
    oldestGapMinutes: snapshot.oldestGapMinutes,
    oldestGapFormatted: formatDuration(snapshot.oldestGapMinutes),
    slaCompliancePercent: historical.slaCompliancePercent,
  };
}

async function computeOpenSnapshot(organizationIds: string[]) {
  const threads = await loadOpenThreadsAcrossOrgs(organizationIds);
  const now = Date.now();
  let overdue = 0, atRisk = 0, onTrack = 0, oldestGapMs = 0;
  const overdueByOrg = new Map<string, { name: string; count: number }>();
  for (const thread of threads) {
    const bucket = classifyUrgency(thread, now);
    if (bucket === "overdue") { overdue++; recordImpactedOrg(overdueByOrg, thread); }
    else if (bucket === "at_risk") atRisk++;
    else onTrack++;
    const elapsedMs = now - thread.lastInboundAt!.getTime();
    if (elapsedMs > oldestGapMs) oldestGapMs = elapsedMs;
  }
  return { open: threads.length, overdue, atRisk, onTrack, oldestGapMinutes: Math.round(oldestGapMs / 60_000), impactedOrgs: buildImpactedList(overdueByOrg) };
}

function recordImpactedOrg(map: Map<string, { name: string; count: number }>, thread: OpenThreadForBucketing): void {
  const existing = map.get(thread.organizationId);
  if (existing) existing.count++;
  else map.set(thread.organizationId, { name: thread.organization.name, count: 1 });
}

function buildImpactedList(map: Map<string, { name: string; count: number }>): ImpactedOrg[] {
  const entries = Array.from(map.entries()).map(([id, v]) => ({ organizationId: id, organizationName: v.name, overdueCount: v.count }));
  return entries.sort((a, b) => b.overdueCount - a.overdueCount);
}

async function loadOpenThreadsAcrossOrgs(organizationIds: string[]) {
  return prisma.thread.findMany({
    where: {
      organizationId: { in: organizationIds },
      coverageStatus: "UNCOVERED",
      lastInboundAt: { not: null },
      dismissedAt: null,
    },
    select: {
      organizationId: true,
      lastInboundAt: true,
      organization: { select: { name: true, settings: { select: { slaMinutes: true } } } },
    },
  });
}

interface OpenThreadForBucketing {
  organizationId: string;
  lastInboundAt: Date | null;
  organization: { name: string; settings: { slaMinutes: number } | null };
}

function classifyUrgency(thread: OpenThreadForBucketing, now: number): "overdue" | "at_risk" | "on_track" {
  const slaMin = thread.organization.settings?.slaMinutes ?? DEFAULT_SLA_MINUTES;
  const slaMs = slaMin * 60_000;
  const elapsedMs = now - thread.lastInboundAt!.getTime();
  if (elapsedMs > slaMs) return "overdue";
  if (elapsedMs >= slaMs * 0.8) return "at_risk";
  return "on_track";
}

async function computeHistoricalCompliance(params: AggregateParams) {
  const respondedThreads = await prisma.thread.findMany({
    where: {
      organizationId: { in: params.organizationIds },
      firstInboundAt: { gte: params.startDate, lte: params.endDate },
      firstResponseMinutes: { not: null },
      dismissedAt: null,
    },
    select: { firstResponseMinutes: true, hadLateFirstResponse: true },
  });
  return summarizeHistorical(respondedThreads);
}

function summarizeHistorical(threads: { firstResponseMinutes: number | null; hadLateFirstResponse: boolean }[]) {
  let covered = 0, late = 0, sumMinutes = 0;
  for (const t of threads) {
    if (t.hadLateFirstResponse) late++;
    else covered++;
    sumMinutes += t.firstResponseMinutes!;
  }
  const total = covered + late;
  const slaCompliancePercent = total > 0 ? Math.round((covered / total) * 10000) / 100 : 0;
  const avgResponseMinutes = total > 0 ? Math.round(sumMinutes / total) : 0;
  return { avgResponseMinutes, slaCompliancePercent };
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(" ");
}
