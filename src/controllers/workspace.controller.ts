import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { NotAuthorizedError, ValidationError } from "../lib/errors";
import { createOwnedWorkspace } from "../services/workspace.service";
import { findOrCreatePlaceholderUser } from "../services/user.service";
import { assertWithinLimitForUser, invalidate } from "../services/entitlements.service";
import type { WorkspaceAccessRole } from "../types/auth";
import type { WorkspaceRole } from "../generated/prisma/client";

const WORKSPACE_SUMMARY_SELECT = {
  id: true,
  name: true,
  ownerUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface CreateWorkspaceBody { name?: string }
interface UpdateWorkspaceBody { name?: string }
interface AddMemberBody { email: string; role?: WorkspaceRole }
interface UpdateMemberBody { role: WorkspaceRole }

function assertOwnerOrAdmin(role: WorkspaceAccessRole, message: string): void {
  if (role !== "OWNER" && role !== "ADMIN") throw new NotAuthorizedError(message);
}

async function enforceWorkspaceLimit(userId: string): Promise<void> {
  const current = await prisma.workspace.count({ where: { ownerUserId: userId } });
  await assertWithinLimitForUser(userId, "workspace_limit", current);
}

async function loadAccessibleWorkspaces(userId: string) {
  const rows = await prisma.workspace.findMany({
    where: { OR: [{ ownerUserId: userId }, { members: { some: { userId } } }] },
    select: { ...WORKSPACE_SUMMARY_SELECT, members: { where: { userId }, select: { role: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => attachAccessRole(r, userId));
}

function attachAccessRole<T extends { ownerUserId: string; members: { role: WorkspaceRole }[] }>(row: T, userId: string) {
  const role: WorkspaceAccessRole = row.ownerUserId === userId ? "OWNER" : row.members[0].role;
  const { members: _members, ...rest } = row;
  return { ...rest, role };
}

export async function listMyWorkspaces(req: Request, res: Response) {
  const workspaces = await loadAccessibleWorkspaces(req.user!.userId);
  res.json({ workspaces });
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
  await enforceWorkspaceLimit(userId);
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
  const { email, role = "MEMBER" } = req.body ?? ({} as AddMemberBody);
  if (!email) throw new ValidationError("email is required");
  const user = await findOrCreatePlaceholderUser(email);
  await rejectIfWorkspaceOwner(user.id, req.workspace.workspaceId);
  const member = await upsertWorkspaceMember(user.id, req.workspace.workspaceId, role);
  res.status(201).json({ member });
}

async function rejectIfWorkspaceOwner(userId: string, workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { ownerUserId: true } });
  if (workspace.ownerUserId === userId) throw new ValidationError("User is already the workspace owner");
}

async function upsertWorkspaceMember(userId: string, workspaceId: string, role: WorkspaceRole) {
  return prisma.workspaceMember.upsert({
    where: { userId_workspaceId: { userId, workspaceId } },
    create: { userId, workspaceId, role },
    update: { role },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
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
