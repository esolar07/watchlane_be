import type { Request, Response, NextFunction } from "express";
import type { OrganizationRole } from "../generated/prisma/client";
import { verifyToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";

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

export async function attachOrgContext(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: req.user.userId },
    include: { organization: { select: { name: true } } },
  });

  if (memberships.length === 0) {
    res.status(403).json({ error: "User is not a member of any organization" });
    return;
  }

  if (memberships.length === 1) {
    const m = memberships[0];
    req.org = {
      orgId: m.organizationId,
      orgName: m.organization.name,
      role: m.role,
    };
    return next();
  }

  // Multiple orgs — require explicit selection
  const selectedOrgId =
    (req.headers["x-org-id"] as string | undefined) ??
    (req.query.orgId as string | undefined);

  if (!selectedOrgId) {
    res.status(400).json({
      error: "Multiple organizations found. Specify orgId.",
      organizations: memberships.map((m) => ({
        id: m.organizationId,
        name: m.organization.name,
        role: m.role,
      })),
    });
    return;
  }

  const selected = memberships.find(
    (m) => m.organizationId === selectedOrgId
  );
  if (!selected) {
    res
      .status(403)
      .json({ error: "User is not a member of the specified organization" });
    return;
  }

  req.org = {
    orgId: selected.organizationId,
    orgName: selected.organization.name,
    role: selected.role,
  };
  next();
}

export function requireRole(...roles: OrganizationRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.org) {
      res.status(403).json({ error: "Organization context required" });
      return;
    }

    if (!roles.includes(req.org.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}
