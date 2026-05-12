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
  if (!req.team) {
    res.status(403).json({ error: "Team context required" });
    return;
  }
  const accounts = await prisma.emailAccount.findMany({
    where: { teamId: req.team.teamId },
    select: ACCOUNT_PUBLIC_FIELDS,
    orderBy: { createdAt: "asc" },
  });
  res.json({ emailAccounts: accounts });
}

export async function getEmailAccount(req: Request, res: Response) {
  if (!req.team) {
    res.status(403).json({ error: "Team context required" });
    return;
  }
  const accountId = String(req.params.accountId);
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, teamId: req.team.teamId },
    select: ACCOUNT_PUBLIC_FIELDS,
  });
  if (!account) {
    res.status(404).json({ error: "Email account not found" });
    return;
  }
  res.json({ emailAccount: account });
}
