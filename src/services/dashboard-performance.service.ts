import { prisma } from "../lib/prisma";
import { resolveMailboxOwnerName } from "../lib/mailbox-owner";

const DEFAULT_SLA_MINUTES = 560;

interface LateResponseThread {
  threadId: string;
  subject: string | null;
  ownerName: string | null;
  emailAddress: string;
  folderPath: string | null;
  firstInboundAt: Date;
  firstOutboundAt: Date;
  firstResponseMinutes: number;
  minutesOverdue: number;
}

interface PerformanceReport {
  slaTarget: number;
  windowStart: Date;
  windowEnd: Date;
  totalInbound: number;
  coveredWithinSla: number;
  lateResponses: number;
  unreplied: number;
  compliancePercent: number;
  avgResponseMinutes: number;
  lateResponseThreads: LateResponseThread[];
}

interface PerformanceParams {
  teamId: string;
  startDate: Date;
  endDate: Date;
  repId?: string;
}

export async function getPerformanceReport(params: PerformanceParams): Promise<PerformanceReport> {
  const slaTarget = await loadSlaTarget(params.teamId);
  const threads = await loadThreadsInWindow(params);
  const summary = summarizeThreads(threads);
  const lateResponseThreads = await buildLateResponseList(threads, slaTarget);
  return assembleReport(slaTarget, params, summary, lateResponseThreads);
}

function assembleReport(
  slaTarget: number,
  params: PerformanceParams,
  summary: { totalInbound: number; covered: number; late: number; unreplied: number; avgResponseMinutes: number },
  lateResponseThreads: LateResponseThread[]
): PerformanceReport {
  const respondable = summary.covered + summary.late;
  const compliancePercent = respondable > 0 ? Math.round((summary.covered / respondable) * 10000) / 100 : 0;
  return {
    slaTarget,
    windowStart: params.startDate,
    windowEnd: params.endDate,
    totalInbound: summary.totalInbound,
    coveredWithinSla: summary.covered,
    lateResponses: summary.late,
    unreplied: summary.unreplied,
    compliancePercent,
    avgResponseMinutes: summary.avgResponseMinutes,
    lateResponseThreads,
  };
}

async function loadSlaTarget(teamId: string): Promise<number> {
  const settings = await prisma.teamSettings.findUnique({ where: { teamId } });
  return settings?.slaMinutes ?? DEFAULT_SLA_MINUTES;
}

async function loadThreadsInWindow(params: PerformanceParams) {
  return prisma.thread.findMany({
    where: {
      teamId: params.teamId,
      firstInboundAt: { gte: params.startDate, lte: params.endDate },
      ...(params.repId && { emailAccount: { userId: params.repId } }),
    },
    select: {
      id: true,
      subject: true,
      firstInboundAt: true,
      firstOutboundAt: true,
      firstResponseMinutes: true,
      hadLateFirstResponse: true,
      folderIds: true,
      emailAccount: { select: { emailAddress: true, user: { select: { name: true } } } },
    },
    orderBy: { firstInboundAt: "desc" },
  });
}

interface ThreadRow {
  id: string;
  subject: string | null;
  firstInboundAt: Date | null;
  firstOutboundAt: Date | null;
  firstResponseMinutes: number | null;
  hadLateFirstResponse: boolean;
  folderIds: string[];
  emailAccount: { emailAddress: string; user: { name: string | null } | null };
}

function summarizeThreads(threads: ThreadRow[]) {
  let covered = 0, late = 0, unreplied = 0, sum = 0, n = 0;
  for (const t of threads) {
    const bucket = classifyThread(t);
    if (bucket === "covered") covered++;
    else if (bucket === "late") late++;
    else unreplied++;
    if (t.firstResponseMinutes !== null) { sum += t.firstResponseMinutes; n++; }
  }
  const avgResponseMinutes = n > 0 ? Math.round(sum / n) : 0;
  return { totalInbound: threads.length, covered, late, unreplied, avgResponseMinutes };
}

function classifyThread(t: ThreadRow): "covered" | "late" | "unreplied" {
  if (t.firstOutboundAt === null) return "unreplied";
  return t.hadLateFirstResponse ? "late" : "covered";
}

async function buildLateResponseList(threads: ThreadRow[], slaTarget: number): Promise<LateResponseThread[]> {
  const lateThreads = threads.filter((t) => t.hadLateFirstResponse && t.firstInboundAt && t.firstOutboundAt);
  const folderPathMap = await loadFolderPathMap(lateThreads.map((t) => t.folderIds));
  return lateThreads.map((t) => buildLateResponseThread(t, folderPathMap, slaTarget));
}

function buildLateResponseThread(t: ThreadRow, folderPathMap: Map<string, string>, slaTarget: number): LateResponseThread {
  const minutes = t.firstResponseMinutes!;
  return {
    threadId: t.id,
    subject: t.subject,
    ownerName: resolveMailboxOwnerName(t.emailAccount.user),
    emailAddress: t.emailAccount.emailAddress,
    folderPath: pickPrimaryFolderPath(t.folderIds, folderPathMap),
    firstInboundAt: t.firstInboundAt!,
    firstOutboundAt: t.firstOutboundAt!,
    firstResponseMinutes: minutes,
    minutesOverdue: minutes - slaTarget,
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
