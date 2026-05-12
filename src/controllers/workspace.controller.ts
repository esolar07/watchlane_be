import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { NotAuthorizedError, ValidationError } from "../lib/errors";
import { createOwnedWorkspace } from "../services/workspace.service";
import { invalidate } from "../services/entitlements.service";
import type { WorkspaceRole } from "../generated/prisma/client";

const WORKSPACE_SUMMARY_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  currentPlan: { select: { slug: true, name: true } },
} as const;

interface CreateWorkspaceBody { name?: string }
interface UpdateWorkspaceBody { name?: string }
interface AddMemberBody { userId: string; role?: WorkspaceRole }
interface UpdateMemberBody { role: WorkspaceRole }

function assertOwnerOrAdmin(role: WorkspaceRole, message: string): void {
  if (role !== "OWNER" && role !== "ADMIN") throw new NotAuthorizedError(message);
}

export async function listMyWorkspaces(req: Request, res: Response) {
  const userId = req.user!.userId;
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: { select: WORKSPACE_SUMMARY_SELECT } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ workspaces: memberships.map((m) => ({ ...m.workspace, role: m.role })) });
}

export async function getWorkspace(req: Request, res: Response) {
  if (!req.workspace) throw new NotAuthorizedError("Workspace context required");
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: req.workspace.workspaceId },
    select: { ...WORKSPACE_SUMMARY_SELECT, members: { include: { user: { select: { id: true, email: true, name: true } } } } },
  });
  res.json({ ...workspace, role: req.workspace.role });
}

export async function createWorkspace(req: Request<{}, {}, CreateWorkspaceBody>, res: Response) {
  const userId = req.user!.userId;
  const name = req.body?.name?.trim();
  if (!name) throw new ValidationError("Workspace name is required");
  const workspaceId = await createOwnedWorkspace(userId, name);
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: WORKSPACE_SUMMARY_SELECT });
  res.status(201).json({ ...workspace, role: "OWNER" });
}

export async function updateWorkspace(req: Request<{}, {}, UpdateWorkspaceBody>, res: Response) {
  if (!req.workspace) throw new NotAuthorizedError("Workspace context required");
  assertOwnerOrAdmin(req.workspace.role, "Only OWNER or ADMIN can update the workspace");
  const name = req.body?.name?.trim();
  if (!name) throw new ValidationError("Workspace name is required");
  const workspace = await prisma.workspace.update({ where: { id: req.workspace.workspaceId }, data: { name }, select: WORKSPACE_SUMMARY_SELECT });
  invalidate(req.workspace.workspaceId);
  res.json({ ...workspace, role: req.workspace.role });
}

export async function listWorkspaceMembers(req: Request, res: Response) {
  if (!req.workspace) throw new NotAuthorizedError("Workspace context required");
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: req.workspace.workspaceId },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ members });
}

export async function addWorkspaceMember(req: Request<{}, {}, AddMemberBody>, res: Response) {
  if (!req.workspace) throw new NotAuthorizedError("Workspace context required");
  assertOwnerOrAdmin(req.workspace.role, "Only OWNER or ADMIN can add workspace members");
  const { userId, role = "MEMBER" } = req.body ?? {};
  if (!userId) throw new ValidationError("userId is required");
  const member = await prisma.workspaceMember.upsert({
    where: { userId_workspaceId: { userId, workspaceId: req.workspace.workspaceId } },
    create: { userId, workspaceId: req.workspace.workspaceId, role },
    update: { role },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  res.status(201).json({ member });
}

export async function updateWorkspaceMember(req: Request<{ memberId: string }, {}, UpdateMemberBody>, res: Response) {
  if (!req.workspace) throw new NotAuthorizedError("Workspace context required");
  assertOwnerOrAdmin(req.workspace.role, "Only OWNER or ADMIN can update workspace members");
  const member = await prisma.workspaceMember.update({
    where: { id: req.params.memberId },
    data: { role: req.body.role },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  res.json({ member });
}

export async function removeWorkspaceMember(req: Request<{ memberId: string }>, res: Response) {
  if (!req.workspace) throw new NotAuthorizedError("Workspace context required");
  assertOwnerOrAdmin(req.workspace.role, "Only OWNER or ADMIN can remove workspace members");
  await prisma.workspaceMember.delete({ where: { id: req.params.memberId } });
  res.status(204).end();
}
