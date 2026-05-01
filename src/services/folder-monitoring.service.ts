import { prisma } from "../lib/prisma";
import type { EmailFolder, SystemFolderKind } from "../generated/prisma/client";

export async function listEffectiveMonitoredFolders(emailAccountId: string): Promise<EmailFolder[]> {
  const folders = await prisma.emailFolder.findMany({ where: { emailAccountId } });
  const byId = buildFolderMap(folders);
  return folders.filter((folder) => resolveEffectiveMonitoring(folder, byId));
}

export async function isEffectivelyMonitored(folderId: string): Promise<boolean> {
  const folder = await prisma.emailFolder.findUniqueOrThrow({ where: { id: folderId } });
  const folders = await prisma.emailFolder.findMany({ where: { emailAccountId: folder.emailAccountId } });
  return resolveEffectiveMonitoring(folder, buildFolderMap(folders));
}

function buildFolderMap(folders: EmailFolder[]): Map<string, EmailFolder> {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

export function resolveEffectiveMonitoring(folder: EmailFolder, byId: Map<string, EmailFolder>): boolean {
  const forced = applySystemFolderOverrides(folder.systemKind);
  if (forced !== null) return forced;
  return walkAncestorsForMonitoring(folder, byId);
}

function applySystemFolderOverrides(kind: SystemFolderKind | null): boolean | null {
  if (kind === "JUNK_EMAIL" || kind === "DELETED_ITEMS") return false;
  return null;
}

function walkAncestorsForMonitoring(start: EmailFolder, byId: Map<string, EmailFolder>): boolean {
  let cursor: EmailFolder | undefined = start;
  while (cursor) {
    if (cursor.monitored !== null) return cursor.monitored;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return false;
}
