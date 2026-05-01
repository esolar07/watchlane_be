import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { backfillFolder } from "../services/folder-backfill.service";
import { fetchMicrosoftMessagesInFolder } from "../services/microsoft-mail.service";

export async function listFolders(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const accountId = String(req.params.accountId);
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    res.status(404).json({ error: "Email account not found" });
    return;
  }
  if (!(await userBelongsToOrg(req.user.userId, account.organizationId))) {
    res.status(403).json({ error: "Not authorized for this email account" });
    return;
  }
  const folders = await prisma.emailFolder.findMany({ where: { emailAccountId: accountId }, orderBy: { path: "asc" } });
  await prisma.emailFolder.updateMany({ where: { emailAccountId: accountId, isNew: true }, data: { isNew: false } });
  res.json({ folders });
}

export async function setFolderMonitored(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const folderId = String(req.params.folderId);
  const parsedValue = parseMonitoredValue(req.body?.monitored);
  if (parsedValue.error) {
    res.status(400).json({ error: parsedValue.error });
    return;
  }
  const folder = await prisma.emailFolder.findUnique({ where: { id: folderId } });
  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: folder.emailAccountId } });
  if (!(await userBelongsToOrg(req.user.userId, account.organizationId))) {
    res.status(403).json({ error: "Not authorized for this folder" });
    return;
  }
  if (isSystemFolderProtected(folder.systemKind)) {
    res.status(400).json({ error: "System folder is not user-editable" });
    return;
  }
  const updated = await prisma.emailFolder.update({ where: { id: folderId }, data: { monitored: parsedValue.value } });
  if (parsedValue.value === true) await backfillFolder(folderId, { fetcher: fetchMicrosoftMessagesInFolder });
  res.json({ folder: updated });
}

function parseMonitoredValue(raw: unknown): { value: boolean | null; error?: string } {
  if (raw === true || raw === false || raw === null) return { value: raw };
  return { value: false, error: "monitored must be true, false, or null" };
}

function isSystemFolderProtected(systemKind: string | null): boolean {
  if (systemKind === null) return false;
  return systemKind !== "INBOX";
}

async function userBelongsToOrg(userId: string, organizationId: string): Promise<boolean> {
  const membership = await prisma.organizationMember.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  return membership !== null;
}
