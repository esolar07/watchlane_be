import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { backfillFolder } from "../services/folder-backfill.service";
import { fetchMicrosoftMessagesInFolder } from "../services/microsoft-mail.service";

export async function listFolders(req: Request, res: Response) {
  if (!req.team) {
    res.status(403).json({ error: "Team context required" });
    return;
  }
  const accountId = String(req.params.accountId);
  const teamId = req.team.teamId;
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, teamId: teamId },
    select: { id: true },
  });
  if (!account) {
    res.status(404).json({ error: "Email account not found" });
    return;
  }
  const folders = await prisma.emailFolder.findMany({
    where: { emailAccountId: accountId, teamId: teamId },
    orderBy: { path: "asc" },
  });
  await prisma.emailFolder.updateMany({
    where: { emailAccountId: accountId, teamId: teamId, isNew: true },
    data: { isNew: false },
  });
  res.json({ folders });
}

export async function setFolderMonitored(req: Request, res: Response) {
  if (!req.team) {
    res.status(403).json({ error: "Team context required" });
    return;
  }
  const folderId = String(req.params.folderId);
  const teamId = req.team.teamId;
  const parsedValue = parseMonitoredValue(req.body?.monitored);
  if (parsedValue.error) {
    res.status(400).json({ error: parsedValue.error });
    return;
  }
  const folder = await prisma.emailFolder.findFirst({
    where: { id: folderId, teamId: teamId },
  });
  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
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
