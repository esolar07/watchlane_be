import type { Request, Response, NextFunction } from "express";
import { PlanFeatureKey } from "../config/plan-features";
import { assertFeature } from "../services/entitlements.service";
import { config } from "../config/env";
import { NotAuthorizedError } from "../lib/errors";

export function requireFeature(key: PlanFeatureKey) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const workspaceId = req.workspace?.workspaceId ?? req.org?.workspaceId;
    if (!workspaceId) return next(new NotAuthorizedError("Workspace context required"));
    try { await assertFeature(workspaceId, key); next(); } catch (err) { next(err); }
  };
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  const email = req.user?.email?.toLowerCase();
  if (!email || !config.adminEmails.includes(email)) return next(new NotAuthorizedError("Super admin access required"));
  next();
}
