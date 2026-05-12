import { prisma } from "../lib/prisma";
import { fetchFolderDelta, fetchWellKnownFolderIds } from "../lib/microsoft-graph";
import { GraphMailFolder } from "../types/folder";
import type { SystemFolderKind } from "../generated/prisma/client";

type SyncPhase = "INITIAL" | "DELTA";

export type FolderFetcher = (
  accessToken: string,
  savedDeltaLink?: string
) => Promise<{ items: GraphMailFolder[]; deltaLink: string | undefined }>;

export type SystemKindResolver = (
  emailAccountId: string,
  accessToken: string,
  phase: SyncPhase
) => Promise<Map<string, SystemFolderKind>>;

export async function syncFolderTree(
  emailAccountId: string,
  accessToken: string,
  fetcher: FolderFetcher = fetchFolderDelta,
  systemKindResolver: SystemKindResolver = resolveSystemKindMap
): Promise<void> {
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: emailAccountId } });
  const phase: SyncPhase = account.foldersDeltaLink ? "DELTA" : "INITIAL";
  const { items, deltaLink } = await fetcher(accessToken, account.foldersDeltaLink ?? undefined);
  const systemKindByExternalId = await systemKindResolver(emailAccountId, accessToken, phase);
  await upsertFolders(emailAccountId, items, { phase, systemKindByExternalId, organizationId: account.organizationId });
  if (deltaLink) await persistDeltaLink(emailAccountId, deltaLink);
}

async function resolveSystemKindMap(
  emailAccountId: string,
  accessToken: string,
  phase: SyncPhase
): Promise<Map<string, SystemFolderKind>> {
  if (phase === "INITIAL") return fetchWellKnownFolderIds(accessToken);
  return loadCachedSystemKindMap(emailAccountId);
}

async function loadCachedSystemKindMap(emailAccountId: string): Promise<Map<string, SystemFolderKind>> {
  const folders = await prisma.emailFolder.findMany({
    where: { emailAccountId, systemKind: { not: null } },
    select: { externalId: true, systemKind: true },
  });
  return new Map(folders.map((row) => [row.externalId, row.systemKind!]));
}

async function persistDeltaLink(emailAccountId: string, deltaLink: string): Promise<void> {
  await prisma.emailAccount.update({ where: { id: emailAccountId }, data: { foldersDeltaLink: deltaLink } });
}

interface UpsertOptions {
  phase: SyncPhase;
  systemKindByExternalId: Map<string, SystemFolderKind>;
  organizationId: string;
}

export async function upsertFolders(
  emailAccountId: string,
  items: GraphMailFolder[],
  opts: UpsertOptions
): Promise<void> {
  const sorted = sortParentsBeforeChildren(items);
  for (const item of sorted) await applyFolderItem(emailAccountId, item, opts);
}

async function applyFolderItem(
  emailAccountId: string,
  item: GraphMailFolder,
  opts: UpsertOptions
): Promise<void> {
  if (item["@removed"]) {
    await deleteFolder(emailAccountId, item.id);
    return;
  }
  const parent = await findParentRow(emailAccountId, item.parentFolderId);
  const previousPath = await readExistingPath(emailAccountId, item.id);
  const newPath = parent ? `${parent.path}/${item.displayName}` : item.displayName;
  await upsertSingleFolder(emailAccountId, item, parent?.id ?? null, newPath, opts);
  if (previousPath && previousPath !== newPath) await cascadePathRename(emailAccountId, previousPath, newPath);
}

async function upsertSingleFolder(
  emailAccountId: string,
  item: GraphMailFolder,
  parentId: string | null,
  path: string,
  opts: UpsertOptions
): Promise<void> {
  const systemKind = opts.systemKindByExternalId.get(item.id) ?? null;
  const existing = await readExistingFolderRow(emailAccountId, item.id);
  const monitored = existing ? existing.monitored : computeInitialMonitored(systemKind, parentId, opts.phase);
  const isNew = existing ? existing.isNew : true;
  await prisma.emailFolder.upsert({
    where: { emailAccountId_externalId: { emailAccountId, externalId: item.id } },
    update: { name: item.displayName, parentId, path, systemKind, isSystem: systemKind !== null },
    create: buildFolderCreateData(emailAccountId, item, parentId, path, systemKind, monitored, isNew, opts.organizationId),
  });
}

function buildFolderCreateData(
  emailAccountId: string,
  item: GraphMailFolder,
  parentId: string | null,
  path: string,
  systemKind: SystemFolderKind | null,
  monitored: boolean | null,
  isNew: boolean,
  organizationId: string
) {
  return {
    organizationId,
    emailAccountId,
    externalId: item.id,
    name: item.displayName,
    parentId,
    path,
    systemKind,
    isSystem: systemKind !== null,
    monitored,
    isNew,
  };
}

async function readExistingFolderRow(emailAccountId: string, externalId: string) {
  return prisma.emailFolder.findUnique({
    where: { emailAccountId_externalId: { emailAccountId, externalId } },
    select: { monitored: true, isNew: true },
  });
}

function computeInitialMonitored(
  systemKind: SystemFolderKind | null,
  parentId: string | null,
  phase: SyncPhase
): boolean | null {
  if (systemKind === "INBOX") return true;
  if (systemKind === "JUNK_EMAIL" || systemKind === "DELETED_ITEMS") return false;
  if (phase === "DELTA") return false;
  return parentId === null ? false : null;
}

async function findParentRow(emailAccountId: string, parentExternalId: string | null) {
  if (!parentExternalId) return null;
  return prisma.emailFolder.findUnique({
    where: { emailAccountId_externalId: { emailAccountId, externalId: parentExternalId } },
    select: { id: true, path: true },
  });
}

async function readExistingPath(emailAccountId: string, externalId: string): Promise<string | null> {
  const row = await prisma.emailFolder.findUnique({
    where: { emailAccountId_externalId: { emailAccountId, externalId } },
    select: { path: true },
  });
  return row?.path ?? null;
}

async function cascadePathRename(emailAccountId: string, oldPath: string, newPath: string): Promise<void> {
  const oldPrefix = `${oldPath}/`;
  await prisma.$executeRawUnsafe(
    `UPDATE "EmailFolder" SET "path" = $1 || substring("path" from char_length($2) + 1) WHERE "emailAccountId" = $3 AND "path" LIKE $4`,
    `${newPath}/`,
    oldPrefix,
    emailAccountId,
    `${oldPrefix}%`
  );
}

async function deleteFolder(emailAccountId: string, externalId: string): Promise<void> {
  await prisma.emailFolder.deleteMany({ where: { emailAccountId, externalId } });
}

function sortParentsBeforeChildren(items: GraphMailFolder[]): GraphMailFolder[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const visited = new Set<string>();
  const out: GraphMailFolder[] = [];
  for (const item of items) walkInsert(item, byId, visited, out);
  return out;
}

function walkInsert(
  item: GraphMailFolder,
  byId: Map<string, GraphMailFolder>,
  visited: Set<string>,
  out: GraphMailFolder[]
): void {
  if (visited.has(item.id)) return;
  const parent = item.parentFolderId ? byId.get(item.parentFolderId) : undefined;
  if (parent) walkInsert(parent, byId, visited, out);
  visited.add(item.id);
  out.push(item);
}
