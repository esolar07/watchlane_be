import { OrganizationRole, WorkspaceRole } from "../generated/prisma/client";

export interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface OrgContext {
  orgId: string;
  orgName: string;
  role: OrganizationRole;
  workspaceId: string;
}

export interface WorkspaceContext {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      org?: OrgContext;
      workspace?: WorkspaceContext;
    }
  }
}
