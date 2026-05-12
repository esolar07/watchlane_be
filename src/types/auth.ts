import { TeamRole, WorkspaceRole } from "../generated/prisma/client";

export type WorkspaceAccessRole = "OWNER" | WorkspaceRole;

export interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface TeamContext {
  teamId: string;
  teamName: string;
  role: TeamRole;
  workspaceId: string;
}

export interface WorkspaceContext {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceAccessRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      team?: TeamContext;
      workspace?: WorkspaceContext;
    }
  }
}
