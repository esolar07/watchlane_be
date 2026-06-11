import type { Request, Response } from "express";
import { config } from "../config/env";
import { prisma } from "../lib/prisma";
import { ValidationError } from "../lib/errors";
import { MICROSOFT_SCOPES } from "../lib/microsoft";
import { assertCallerCanManageTeam } from "../services/team-access.service";
import {
  createMailboxConnectInvite,
  listMailboxConnectInvitesForTeam,
  revokeMailboxConnectInvite,
} from "../services/mailbox-invite.service";
import { sendMailboxConnectInviteEmail } from "../services/email-notifications.service";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CreateMailboxInviteBody { sendToEmail?: string }

function getBackendOrigin(): string {
  return new URL(config.microsoft.redirectUri).origin;
}

function buildPublicInviteUrl(token: string): string {
  return `${getBackendOrigin()}/invite/mailbox/${token}`;
}

function normalizeInviteEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(trimmed)) throw new ValidationError("Invalid email");
  return trimmed;
}

async function loadTeamName(teamId: string): Promise<string> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { name: true } });
  return team.name;
}

async function deliverInviteEmail(recipient: string, teamId: string, url: string): Promise<boolean> {
  try {
    await sendMailboxConnectInviteEmail(recipient, await loadTeamName(teamId), url);
    return true;
  } catch (error) {
    console.error("[email] Failed to send mailbox invite email", error);
    return false;
  }
}

export async function createInvite(req: Request<{ teamId: string }, {}, CreateMailboxInviteBody>, res: Response) {
  const { teamId } = req.params;
  await assertCallerCanManageTeam(req.user!.userId, teamId);
  const sentToEmail = req.body?.sendToEmail ? normalizeInviteEmail(req.body.sendToEmail) : null;
  const invite = await createMailboxConnectInvite({ teamId, createdByUserId: req.user!.userId, sentToEmail });
  const url = buildPublicInviteUrl(invite.token);
  const emailed = sentToEmail ? await deliverInviteEmail(sentToEmail, teamId, url) : false;
  res.status(201).json({ invite, url, emailed });
}

export async function listInvites(req: Request<{ teamId: string }>, res: Response) {
  const { teamId } = req.params;
  await assertCallerCanManageTeam(req.user!.userId, teamId);
  const invites = await listMailboxConnectInvitesForTeam(teamId);
  const decorated = invites.map((i) => ({ ...i, url: buildPublicInviteUrl(i.token) }));
  res.json({ invites: decorated });
}

export async function revokeInvite(req: Request<{ teamId: string; inviteId: string }>, res: Response) {
  const { teamId, inviteId } = req.params;
  await assertCallerCanManageTeam(req.user!.userId, teamId);
  const revoked = await revokeMailboxConnectInvite(inviteId, teamId);
  if (!revoked) { res.status(404).json({ error: "Invite not found" }); return; }
  res.status(204).end();
}

function buildMicrosoftAuthorizeUrlForInvite(inviteId: string): string {
  const state = Buffer.from(JSON.stringify({ flow: "mailbox_invite", inviteId })).toString("base64url");
  const params = new URLSearchParams({
    client_id: config.microsoft.clientId,
    response_type: "code",
    redirect_uri: config.microsoft.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
    prompt: "consent",
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}

export async function getPublicInvite(req: Request<{ token: string }>, res: Response) {
  const invite = await prisma.mailboxConnectInvite.findUnique({ where: { token: req.params.token } });
  if (!invite) { res.status(404).json({ error: "Invite not found" }); return; }
  if (invite.revokedAt) { res.status(410).json({ error: "Invite has been revoked" }); return; }
  res.redirect(buildMicrosoftAuthorizeUrlForInvite(invite.id));
}
