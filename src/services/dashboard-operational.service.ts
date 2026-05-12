import { prisma } from "../lib/prisma";

const DEFAULT_SLA_MINUTES = 560;

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

interface OperationalActivityItem {
  type: "overdue" | "at_risk" | "covered" | "dismissed" | "sync_success" | "sync_failed";
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

const RECENT_ACTIVITY_HOURS = 24;

interface OperationalSnapshot {
  slaTarget: number;
  lastSyncAt: Date | null;
  overdueCount: number;
  atRiskCount: number;
  openCount: number;
  oldestUncoveredMinutes: number;
  overdueThreads: OpenThread[];
  atRiskThreads: OpenThread[];
  recentActivity: OperationalActivityItem[];
}

interface OperationalParams {
  teamId: string;
  repId?: string;
}

export async function getOperationalSnapshot(params: OperationalParams): Promise<OperationalSnapshot> {
  const slaTarget = await loadSlaTarget(params.teamId);
  const lastSyncAt = await loadLastSyncAt(params.teamId, params.repId);
  const openThreads = await loadOpenThreads(params, slaTarget);
  const partitioned = partitionByUrgency(openThreads);
  const oldestUncoveredMinutes = computeOldestUncoveredMinutes(openThreads);
  const recentActivity = await buildRecentActivity(params, partitioned, slaTarget);
  return assembleSnapshot(slaTarget, lastSyncAt, partitioned, oldestUncoveredMinutes, recentActivity);
}

function assembleSnapshot(
  slaTarget: number,
  lastSyncAt: Date | null,
  partitioned: { overdue: OpenThread[]; atRisk: OpenThread[]; openTotal: number },
  oldestUncoveredMinutes: number,
  recentActivity: OperationalActivityItem[]
): OperationalSnapshot {
  return {
    slaTarget,
    lastSyncAt,
    overdueCount: partitioned.overdue.length,
    atRiskCount: partitioned.atRisk.length,
    openCount: partitioned.openTotal,
    oldestUncoveredMinutes,
    overdueThreads: partitioned.overdue,
    atRiskThreads: partitioned.atRisk,
    recentActivity,
  };
}

async function loadSlaTarget(teamId: string): Promise<number> {
  const settings = await prisma.teamSettings.findUnique({ where: { teamId } });
  return settings?.slaMinutes ?? DEFAULT_SLA_MINUTES;
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

async function loadOpenThreads(params: OperationalParams, slaTarget: number): Promise<OpenThread[]> {
  const slaMs = slaTarget * 60_000;
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
    },
    orderBy: { lastInboundAt: "asc" },
  });
  const folderPathMap = await loadFolderPathMap(threads.map((t) => t.folderIds));
  return threads.map((t) => buildOpenThread(t, folderPathMap, slaMs));
}

function buildOpenThread(
  thread: {
    id: string;
    subject: string | null;
    lastInboundAt: Date | null;
    folderIds: string[];
    emailAccount: { emailAddress: string; user: { name: string | null } };
  },
  folderPathMap: Map<string, string>,
  slaMs: number
): OpenThread {
  const lastInboundAt = thread.lastInboundAt!;
  const elapsedMs = Date.now() - lastInboundAt.getTime();
  return {
    threadId: thread.id,
    subject: thread.subject,
    ownerName: thread.emailAccount.user.name,
    emailAddress: thread.emailAccount.emailAddress,
    folderPath: pickPrimaryFolderPath(thread.folderIds, folderPathMap),
    lastInboundAt,
    minutesWaiting: Math.round(elapsedMs / 60_000),
    isPastSla: elapsedMs > slaMs,
    isAtRisk: elapsedMs >= slaMs * 0.8 && elapsedMs <= slaMs,
  };
}

function partitionByUrgency(open: OpenThread[]): { overdue: OpenThread[]; atRisk: OpenThread[]; openTotal: number } {
  const overdue = open.filter((t) => t.isPastSla);
  const atRisk = open.filter((t) => t.isAtRisk);
  return { overdue, atRisk, openTotal: open.length };
}

function computeOldestUncoveredMinutes(open: OpenThread[]): number {
  if (open.length === 0) return 0;
  return Math.max(...open.map((t) => t.minutesWaiting));
}

async function buildRecentActivity(
  params: OperationalParams,
  partitioned: { overdue: OpenThread[]; atRisk: OpenThread[] },
  slaTarget: number
): Promise<OperationalActivityItem[]> {
  const items: OperationalActivityItem[] = [];
  for (const thread of partitioned.overdue) items.push(makeOverdueItem(thread, slaTarget));
  for (const thread of partitioned.atRisk) items.push(makeAtRiskItem(thread, slaTarget));
  const coveredItems = await buildRecentCoveredActivity(params);
  items.push(...coveredItems);
  const dismissedItems = await buildRecentDismissedActivity(params);
  items.push(...dismissedItems);
  const syncItems = await buildSyncActivity(params);
  items.push(...syncItems);
  return sortRecentActivity(items);
}

async function buildRecentCoveredActivity(params: OperationalParams): Promise<OperationalActivityItem[]> {
  const since = new Date(Date.now() - RECENT_ACTIVITY_HOURS * 60 * 60 * 1000);
  const threads = await prisma.thread.findMany({
    where: {
      teamId: params.teamId,
      coverageStatus: "COVERED",
      lastOutboundAt: { gte: since },
      dismissedAt: null,
      ...(params.repId && { emailAccount: { userId: params.repId } }),
    },
    select: {
      id: true,
      subject: true,
      lastOutboundAt: true,
      lastInboundAt: true,
      folderIds: true,
      emailAccount: { select: { user: { select: { name: true } } } },
    },
    orderBy: { lastOutboundAt: "desc" },
    take: 20,
  });
  const folderPathMap = await loadFolderPathMap(threads.map((t) => t.folderIds));
  return threads.map((t) => makeCoveredItem(t, folderPathMap));
}

function makeCoveredItem(
  thread: { id: string; subject: string | null; lastOutboundAt: Date | null; lastInboundAt: Date | null; folderIds: string[]; emailAccount: { user: { name: string | null } } },
  folderPathMap: Map<string, string>
): OperationalActivityItem {
  const responseMinutes = thread.lastInboundAt ? Math.round((thread.lastOutboundAt!.getTime() - thread.lastInboundAt.getTime()) / 60_000) : null;
  const messageBody = responseMinutes !== null && responseMinutes >= 0
    ? `Replied to '${thread.subject ?? "Untitled"}' in ${responseMinutes} minutes`
    : `Replied to '${thread.subject ?? "Untitled"}'`;
  return {
    type: "covered",
    message: messageBody,
    threadId: thread.id,
    subject: thread.subject,
    ownerName: thread.emailAccount.user.name,
    folderPath: pickPrimaryFolderPath(thread.folderIds, folderPathMap),
    responseMinutes: responseMinutes ?? undefined,
    timestamp: thread.lastOutboundAt!,
  };
}

async function buildRecentDismissedActivity(params: OperationalParams): Promise<OperationalActivityItem[]> {
  const since = new Date(Date.now() - RECENT_ACTIVITY_HOURS * 60 * 60 * 1000);
  const threads = await prisma.thread.findMany({
    where: {
      teamId: params.teamId,
      dismissedAt: { gte: since },
      ...(params.repId && { emailAccount: { userId: params.repId } }),
    },
    select: {
      id: true,
      subject: true,
      dismissedAt: true,
      folderIds: true,
      emailAccount: { select: { user: { select: { name: true } } } },
    },
    orderBy: { dismissedAt: "desc" },
    take: 20,
  });
  const folderPathMap = await loadFolderPathMap(threads.map((t) => t.folderIds));
  return threads.map((t) => makeDismissedItem(t, folderPathMap));
}

function makeDismissedItem(
  thread: { id: string; subject: string | null; dismissedAt: Date | null; folderIds: string[]; emailAccount: { user: { name: string | null } } },
  folderPathMap: Map<string, string>
): OperationalActivityItem {
  return {
    type: "dismissed",
    message: `Thread '${thread.subject ?? "Untitled"}' was deleted from inbox`,
    threadId: thread.id,
    subject: thread.subject,
    ownerName: thread.emailAccount.user.name,
    folderPath: pickPrimaryFolderPath(thread.folderIds, folderPathMap),
    timestamp: thread.dismissedAt!,
  };
}

function makeOverdueItem(thread: OpenThread, slaTarget: number): OperationalActivityItem {
  const minutesOverdue = thread.minutesWaiting - slaTarget;
  return {
    type: "overdue",
    message: `Thread '${thread.subject ?? "Untitled"}' is overdue by ${minutesOverdue} minutes`,
    threadId: thread.threadId,
    subject: thread.subject,
    ownerName: thread.ownerName,
    folderPath: thread.folderPath,
    minutesOverdue,
    timestamp: thread.lastInboundAt,
  };
}

function makeAtRiskItem(thread: OpenThread, slaTarget: number): OperationalActivityItem {
  const minutesRemaining = slaTarget - thread.minutesWaiting;
  return {
    type: "at_risk",
    message: `Thread '${thread.subject ?? "Untitled"}' has ${minutesRemaining} minutes before SLA breach`,
    threadId: thread.threadId,
    subject: thread.subject,
    ownerName: thread.ownerName,
    folderPath: thread.folderPath,
    minutesRemaining,
    timestamp: thread.lastInboundAt,
  };
}

async function buildSyncActivity(params: OperationalParams): Promise<OperationalActivityItem[]> {
  const accounts = await prisma.emailAccount.findMany({
    where: { teamId: params.teamId, ...(params.repId && { userId: params.repId }) },
    select: { emailAddress: true, lastSyncAt: true, tokenExpiresAt: true },
  });
  const now = Date.now();
  return accounts.filter((a) => a.lastSyncAt).map((a) => makeSyncItem(a, now));
}

function makeSyncItem(
  account: { emailAddress: string; lastSyncAt: Date | null; tokenExpiresAt: Date | null },
  now: number
): OperationalActivityItem {
  const expired = account.tokenExpiresAt && account.tokenExpiresAt.getTime() < now;
  if (expired) return { type: "sync_failed", message: `Mailbox ${account.emailAddress} sync failed — token refresh required`, emailAddress: account.emailAddress, timestamp: account.lastSyncAt! };
  return { type: "sync_success", message: `Mailbox ${account.emailAddress} synced successfully`, emailAddress: account.emailAddress, timestamp: account.lastSyncAt! };
}

function sortRecentActivity(items: OperationalActivityItem[]): OperationalActivityItem[] {
  const priority = { overdue: 0, at_risk: 1, covered: 2, dismissed: 3, sync_failed: 4, sync_success: 5 } as const;
  return items.sort((a, b) => priority[a.type] - priority[b.type] || b.timestamp.getTime() - a.timestamp.getTime());
}

async function loadFolderPathMap(folderIdLists: string[][]): Promise<Map<string, string>> {
  const allIds = collectUniqueFolderIds(folderIdLists);
  if (allIds.length === 0) return new Map();
  const folders = await prisma.emailFolder.findMany({ where: { id: { in: allIds } }, select: { id: true, path: true } });
  return new Map(folders.map((f) => [f.id, f.path]));
}

function collectUniqueFolderIds(folderIdLists: string[][]): string[] {
  const set = new Set<string>();
  for (const list of folderIdLists) for (const id of list) set.add(id);
  return Array.from(set);
}

function pickPrimaryFolderPath(folderIds: string[], pathsById: Map<string, string>): string | null {
  if (folderIds.length === 0) return null;
  const paths = folderIds.map((id) => pathsById.get(id)).filter((p): p is string => Boolean(p));
  if (paths.length === 0) return null;
  return paths.sort()[0];
}
