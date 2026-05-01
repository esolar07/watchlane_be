import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";

const ACCOUNT_PUBLIC_FIELDS = {
  id: true,
  emailAddress: true,
  provider: true,
  lastSyncAt: true,
  createdAt: true,
} as const;

export async function listEmailAccounts(req: Request, res: Response) {
  if (!req.org) {
    res.status(403).json({ error: "Organization context required" });
    return;
  }
  const accounts = await prisma.emailAccount.findMany({
    where: { organizationId: req.org.orgId },
    select: ACCOUNT_PUBLIC_FIELDS,
    orderBy: { createdAt: "asc" },
  });
  res.json({ emailAccounts: accounts });
}

export async function getEmailAccount(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const accountId = String(req.params.accountId);
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId },
    select: { ...ACCOUNT_PUBLIC_FIELDS, organizationId: true },
  });
  if (!account) {
    res.status(404).json({ error: "Email account not found" });
    return;
  }
  if (!(await userBelongsToOrg(req.user.userId, account.organizationId))) {
    res.status(403).json({ error: "Not authorized for this email account" });
    return;
  }
  const { organizationId: _, ...publicAccount } = account;
  res.json({ emailAccount: publicAccount });
}

async function userBelongsToOrg(userId: string, organizationId: string): Promise<boolean> {
  const membership = await prisma.organizationMember.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  return membership !== null;
}
