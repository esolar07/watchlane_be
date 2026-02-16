import { OrganizationRole } from "../generated/prisma/client";

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
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      org?: OrgContext;
    }
  }
}
