import { prisma } from "../lib/prisma";
import { generateInviteToken } from "../lib/invite-tokens";

type CreateInviteInput = {
  teamId: string;
  createdByUserId: string;
  sentToEmail: string | null;
};

export async function createMailboxConnectInvite(input: CreateInviteInput) {
  return prisma.mailboxConnectInvite.create({
    data: { ...input, token: generateInviteToken() },
  });
}

export async function listMailboxConnectInvitesForTeam(teamId: string) {
  return prisma.mailboxConnectInvite.findMany({
    where: { teamId },
    orderBy: { createdAt: "desc" },
  });
}

export async function findActiveMailboxConnectInviteByToken(token: string) {
  return prisma.mailboxConnectInvite.findFirst({
    where: { token, revokedAt: null },
  });
}

export async function findActiveMailboxConnectInviteById(id: string) {
  return prisma.mailboxConnectInvite.findFirst({
    where: { id, revokedAt: null },
  });
}

export async function revokeMailboxConnectInvite(id: string, teamId: string): Promise<boolean> {
  const result = await prisma.mailboxConnectInvite.updateMany({
    where: { id, teamId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}
