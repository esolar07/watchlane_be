import { prisma } from "../lib/prisma";
import { getPerformanceReport } from "./dashboard-performance.service";

const DEFAULT_SLA_MINUTES = 560;

interface OrgDashboardParams {
  teamId: string;
  startDate: Date;
  endDate: Date;
  repId?: string;
}

interface KpiSection {
  openThreads: number;
  overdue: number;
  atRisk: number;
  oldestGapMinutes: number;
  oldestGapFormatted: string;
}

interface ThreadRow {
  threadId: string;
  status: "Overdue" | "At Risk" | "Open";
  from: string | null;
  subject: string | null;
  owner: string | null;
  emailAddress: string;
  folderPath: string | null;
  timeOpenMinutes: number;
  timeOpenFormatted: string;
  slaCountdownMinutes: number;
  slaCountdownFormatted: string;
}

interface ActivityItem {
  type: "overdue" | "at_risk" | "covered" | "sync_success" | "sync_failed";
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

interface PerformanceSection {
  slaCompliancePercent: number;
  avgResponseMinutes: number;
  avgResponseFormatted: string;
}

interface OrgDashboard {
  teamId: string;
  teamName: string;
  slaTarget: number;
  lastSyncAt: Date | null;
  kpis: KpiSection;
  threads: ThreadRow[];
  activity: ActivityItem[];
  performance: PerformanceSection;
}

export async function getOrgDashboard(params: OrgDashboardParams): Promise<OrgDashboard> {
  const org = await prisma.team.findUniqueOrThrow({
    where: { id: params.teamId },
    select: { name: true, settings: { select: { slaMinutes: true } } },
  });
  const slaTarget = org.settings?.slaMinutes ?? DEFAULT_SLA_MINUTES;
  const lastSyncAt = await loadLastSyncAt(params.teamId, params.repId);
  const openThreadRows = await loadOpenThreadRows(params, slaTarget);
  const kpis = buildKpis(openThreadRows);
  const activity = await buildActivityFeed(params, openThreadRows);
  const performance = await buildPerformanceSection(params);
  return { teamId: params.teamId, teamName: org.name, slaTarget, lastSyncAt, kpis, threads: openThreadRows, activity, performance };
}

async function loadLastSyncAt(teamId: string, repId?: string): Promise<Date | null> {
  const accounts = await prisma.emailAccount.findMany({
    where: { teamId, ...(repId && { userId: repId }) },
    select: { lastSyncAt: true },
    orderBy: { lastSyncAt: "desc" },
    take: 1,
  });
  return accounts[0]?.lastSyncAt ?? null;
}

async function loadOpenThreadRows(params: OrgDashboardParams, slaTarget: number): Promise<ThreadRow[]> {
  const threads = await prisma.thread.findMany({
    where: {
      teamId: params.teamId,
      coverageStatus: "UNCOVERED",
      lastInboundAt: { not: null },
      dismissedAt: null,
      ...(params.repId && { emailAccount: { userId: params.repId } }),
    },
    select: {
      id: true,
      subject: true,
      lastInboundAt: true,
      folderIds: true,
      emailAccount: { select: { emailAddress: true, user: { select: { name: true } } } },
      messages: { where: { direction: "INBOUND" }, select: { sender: true }, orderBy: { sentAt: "desc" }, take: 1 },
    },
    orderBy: { lastInboundAt: "asc" },
  });
  const folderPathMap = await loadFolderPathMap(threads.map((t) => t.folderIds));
  return threads.map((t) => buildThreadRow(t, folderPathMap, slaTarget));
}

function buildThreadRow(
  thread: {
    id: string;
    subject: string | null;
    lastInboundAt: Date | null;
    folderIds: string[];
    emailAccount: { emailAddress: string; user: { name: string | null } };
    messages: { sender: string }[];
  },
  folderPathMap: Map<string, string>,
  slaTarget: number
): ThreadRow {
  const elapsedMs = Date.now() - thread.lastInboundAt!.getTime();
  const timeOpenMin = Math.round(elapsedMs / 60_000);
  const slaCountdownMin = slaTarget - timeOpenMin;
  return {
    threadId: thread.id,
    status: classifyStatus(timeOpenMin, slaTarget),
    from: thread.messages[0]?.sender ?? null,
    subject: thread.subject,
    owner: thread.emailAccount.user.name,
    emailAddress: thread.emailAccount.emailAddress,
    folderPath: pickPrimaryFolderPath(thread.folderIds, folderPathMap),
    timeOpenMinutes: timeOpenMin,
    timeOpenFormatted: formatDuration(timeOpenMin),
    slaCountdownMinutes: slaCountdownMin,
    slaCountdownFormatted: formatSlaCountdown(slaCountdownMin),
  };
}

function classifyStatus(timeOpenMin: number, slaTarget: number): "Overdue" | "At Risk" | "Open" {
  if (timeOpenMin > slaTarget) return "Overdue";
  if (timeOpenMin >= slaTarget * 0.8) return "At Risk";
  return "Open";
}

function buildKpis(rows: ThreadRow[]): KpiSection {
  const overdue = rows.filter((r) => r.status === "Overdue").length;
  const atRisk = rows.filter((r) => r.status === "At Risk").length;
  const oldestGapMin = rows.length > 0 ? Math.max(...rows.map((r) => r.timeOpenMinutes)) : 0;
  return {
    openThreads: rows.length,
    overdue,
    atRisk,
    oldestGapMinutes: oldestGapMin,
    oldestGapFormatted: formatDuration(oldestGapMin),
  };
}

async function buildActivityFeed(params: OrgDashboardParams, openThreadRows: ThreadRow[]): Promise<ActivityItem[]> {
  const items: ActivityItem[] = [];
  for (const row of openThreadRows.filter((r) => r.status === "Overdue")) items.push(makeOverdueItem(row));
  for (const row of openThreadRows.filter((r) => r.status === "At Risk")) items.push(makeAtRiskItem(row));
  const coveredItems = await buildRecentCoveredItems(params);
  items.push(...coveredItems);
  const syncItems = await buildSyncItems(params);
  items.push(...syncItems);
  return sortActivity(items);
}

function makeOverdueItem(row: ThreadRow): ActivityItem {
  return {
    type: "overdue",
    message: `Thread '${row.subject ?? "Untitled"}' is overdue by ${Math.abs(row.slaCountdownMinutes)} minutes`,
    threadId: row.threadId,
    subject: row.subject,
    ownerName: row.owner,
    folderPath: row.folderPath,
    minutesOverdue: Math.abs(row.slaCountdownMinutes),
    timestamp: new Date(Date.now() - row.timeOpenMinutes * 60_000),
  };
}

function makeAtRiskItem(row: ThreadRow): ActivityItem {
  return {
    type: "at_risk",
    message: `Thread '${row.subject ?? "Untitled"}' has ${row.slaCountdownMinutes} minutes before SLA breach`,
    threadId: row.threadId,
    subject: row.subject,
    ownerName: row.owner,
    folderPath: row.folderPath,
    minutesRemaining: row.slaCountdownMinutes,
    timestamp: new Date(Date.now() - row.timeOpenMinutes * 60_000),
  };
}

async function buildRecentCoveredItems(params: OrgDashboardParams): Promise<ActivityItem[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const threads = await prisma.thread.findMany({
    where: {
      teamId: params.teamId,
      coverageStatus: "COVERED",
      lastOutboundAt: { gte: since },
      dismissedAt: null,
      ...(params.repId && { emailAccount: { userId: params.repId } }),
    },
    select: { id: true, subject: true, lastOutboundAt: true, lastInboundAt: true, folderIds: true, emailAccount: { select: { user: { select: { name: true } } } } },
    orderBy: { lastOutboundAt: "desc" },
    take: 20,
  });
  const folderPathMap = await loadFolderPathMap(threads.map((t) => t.folderIds));
  return threads.map((t) => makeCoveredItem(t, folderPathMap));
}

function makeCoveredItem(
  thread: { id: string; subject: string | null; lastOutboundAt: Date | null; lastInboundAt: Date | null; folderIds: string[]; emailAccount: { user: { name: string | null } } },
  folderPathMap: Map<string, string>
): ActivityItem {
  const responseMinutes = thread.lastInboundAt && thread.lastOutboundAt && thread.lastOutboundAt > thread.lastInboundAt
    ? Math.round((thread.lastOutboundAt.getTime() - thread.lastInboundAt.getTime()) / 60_000)
    : null;
  return {
    type: "covered",
    message: responseMinutes !== null ? `Replied to '${thread.subject ?? "Untitled"}' in ${responseMinutes} minutes` : `Replied to '${thread.subject ?? "Untitled"}'`,
    threadId: thread.id,
    subject: thread.subject,
    ownerName: thread.emailAccount.user.name,
    folderPath: pickPrimaryFolderPath(thread.folderIds, folderPathMap),
    responseMinutes: responseMinutes ?? undefined,
    timestamp: thread.lastOutboundAt!,
  };
}

async function buildSyncItems(params: OrgDashboardParams): Promise<ActivityItem[]> {
  const accounts = await prisma.emailAccount.findMany({
    where: { teamId: params.teamId, ...(params.repId && { userId: params.repId }) },
    select: { emailAddress: true, lastSyncAt: true, tokenExpiresAt: true },
  });
  const now = Date.now();
  return accounts.filter((a) => a.lastSyncAt).map((a) => makeSyncItem(a, now));
}

function makeSyncItem(account: { emailAddress: string; lastSyncAt: Date | null; tokenExpiresAt: Date | null }, now: number): ActivityItem {
  const expired = account.tokenExpiresAt && account.tokenExpiresAt.getTime() < now;
  if (expired) return { type: "sync_failed", message: `Mailbox ${account.emailAddress} sync failed — token refresh required`, emailAddress: account.emailAddress, timestamp: account.lastSyncAt! };
  return { type: "sync_success", message: `Mailbox ${account.emailAddress} synced successfully`, emailAddress: account.emailAddress, timestamp: account.lastSyncAt! };
}

function sortActivity(items: ActivityItem[]): ActivityItem[] {
  const priority = { overdue: 0, at_risk: 1, covered: 2, sync_failed: 3, sync_success: 4 } as const;
  return items.sort((a, b) => priority[a.type] - priority[b.type] || b.timestamp.getTime() - a.timestamp.getTime());
}

async function buildPerformanceSection(params: OrgDashboardParams): Promise<PerformanceSection> {
  const report = await getPerformanceReport({ teamId: params.teamId, startDate: params.startDate, endDate: params.endDate, repId: params.repId });
  return {
    slaCompliancePercent: report.compliancePercent,
    avgResponseMinutes: report.avgResponseMinutes,
    avgResponseFormatted: formatDuration(report.avgResponseMinutes),
  };
}

async function loadFolderPathMap(folderIdLists: string[][]): Promise<Map<string, string>> {
  const allIds = new Set<string>();
  for (const list of folderIdLists) for (const id of list) allIds.add(id);
  if (allIds.size === 0) return new Map();
  const folders = await prisma.emailFolder.findMany({ where: { id: { in: Array.from(allIds) } }, select: { id: true, path: true } });
  return new Map(folders.map((f) => [f.id, f.path]));
}

function pickPrimaryFolderPath(folderIds: string[], pathsById: Map<string, string>): string | null {
  if (folderIds.length === 0) return null;
  const paths = folderIds.map((id) => pathsById.get(id)).filter((p): p is string => Boolean(p));
  if (paths.length === 0) return null;
  return paths.sort()[0];
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

function formatSlaCountdown(slaCountdownMin: number): string {
  if (slaCountdownMin >= 0) return `${formatDuration(slaCountdownMin)} until breach`;
  return `${formatDuration(Math.abs(slaCountdownMin))} past SLA`;
}
