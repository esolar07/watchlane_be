import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getEntitlements } from "../services/entitlements.service";
import { NotAuthorizedError } from "../lib/errors";

async function loadWorkspaceUsage(workspaceId: string) {
  const [mailboxesUsed, orgsUsed] = await Promise.all([
    prisma.emailAccount.count({ where: { team: { workspaceId } } }),
    prisma.team.count({ where: { workspaceId } }),
  ]);
  return { mailboxes_used: mailboxesUsed, orgs_used: orgsUsed };
}

export async function getMyEntitlements(req: Request, res: Response) {
  if (!req.workspace) throw new NotAuthorizedError("Workspace context required");
  const [entitlements, usage] = await Promise.all([getEntitlements(req.workspace.workspaceId), loadWorkspaceUsage(req.workspace.workspaceId)]);
  res.json({ workspace: { id: req.workspace.workspaceId, name: req.workspace.workspaceName }, ...entitlements, usage });
}
