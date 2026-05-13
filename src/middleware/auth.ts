import type { Request, Response, NextFunction } from "express";
import type { TeamRole } from "../generated/prisma/client";
import { verifyToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import type { WorkspaceAccessRole, WorkspaceContext } from "../types/auth";

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function attachTeamContext(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const memberships = await prisma.teamMember.findMany({
    where: { userId: req.user.userId },
    include: { team: { select: { name: true, workspaceId: true } } },
  });

  if (memberships.length === 0) {
    res.status(403).json({ error: "User is not a member of any team" });
    return;
  }

  if (memberships.length === 1) {
    const m = memberships[0];
    req.team = {
      teamId: m.teamId,
      teamName: m.team.name,
      role: m.role,
      workspaceId: m.team.workspaceId,
    };
    return next();
  }

  const selectedTeamId =
    (req.headers["x-team-id"] as string | undefined) ??
    (req.query.teamId as string | undefined);

  if (!selectedTeamId) {
    res.status(400).json({
      error: "Multiple teams found. Specify teamId.",
      teams: memberships.map((m) => ({
        id: m.teamId,
        name: m.team.name,
        role: m.role,
      })),
    });
    return;
  }

  const selected = memberships.find(
    (m) => m.teamId === selectedTeamId
  );
  if (!selected) {
    res
      .status(403)
      .json({ error: "User is not a member of the specified team" });
    return;
  }

  req.team = {
    teamId: selected.teamId,
    teamName: selected.team.name,
    role: selected.role,
    workspaceId: selected.team.workspaceId,
  };
  next();
}

export async function attachWorkspaceContext(req: Request, res: Response, next: NextFunction) {
  if (!req.user) { res.status(401).json({ error: "Authentication required" }); return; }
  const accessible = await loadAccessibleWorkspaces(req.user.userId);
  const selectedId = readSelectedWorkspaceId(req);
  const picked = pickAccessibleWorkspace(accessible, selectedId);
  if (!picked) { respondWorkspacePickFailure(res, accessible, selectedId); return; }
  req.workspace = picked;
  next();
}

async function loadAccessibleWorkspaces(userId: string): Promise<WorkspaceContext[]> {
  const rows = await prisma.workspace.findMany({
    where: { OR: [{ ownerUserId: userId }, { members: { some: { userId } } }] },
    select: { id: true, name: true, ownerUserId: true, members: { where: { userId }, select: { role: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((w) => toWorkspaceContext(w, userId));
}

function toWorkspaceContext(row: { id: string; name: string; ownerUserId: string; members: { role: WorkspaceAccessRole }[] }, userId: string): WorkspaceContext {
  const role: WorkspaceAccessRole = row.ownerUserId === userId ? "OWNER" : row.members[0].role;
  return { workspaceId: row.id, workspaceName: row.name, role };
}

function readSelectedWorkspaceId(req: Request): string | undefined {
  return (req.headers["x-workspace-id"] as string | undefined) ?? (req.query.workspaceId as string | undefined);
}

function pickAccessibleWorkspace(workspaces: WorkspaceContext[], selectedId: string | undefined): WorkspaceContext | undefined {
  if (workspaces.length === 1 && !selectedId) return workspaces[0];
  if (!selectedId) return undefined;
  return workspaces.find((w) => w.workspaceId === selectedId);
}

function respondWorkspacePickFailure(res: Response, accessible: WorkspaceContext[], selectedId: string | undefined): void {
  const ambiguous = accessible.length > 1 && !selectedId;
  const status = accessible.length === 0 ? 403 : ambiguous ? 400 : 403;
  const error = accessible.length === 0
    ? "User has no accessible workspaces"
    : ambiguous ? "Multiple workspaces found. Specify workspaceId."
    : "User does not have access to the specified workspace";
  res.status(status).json({ error, workspaces: accessible });
}

export function requireRole(...roles: TeamRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.team) {
      res.status(403).json({ error: "Team context required" });
      return;
    }
    if (!roles.includes(req.team.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

