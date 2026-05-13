import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { config } from "../config/env";
import { prisma } from "../lib/prisma";
import { signToken, verifyToken } from "../lib/jwt";
import { encrypt } from "../lib/encryption";
import {
  exchangeCodeForTokens,
  decodeIdToken,
  MICROSOFT_SCOPES,
  MICROSOFT_SSO_SCOPES,
} from "../lib/microsoft";
import { syncMailbox } from "../services/microsoft-mail.service";
import { assertWithinLimit } from "../services/entitlements.service";
import { HttpError } from "../lib/errors";
import { ensureUserHasWorkspace, ensureUserHasFirstTeam, defaultWorkspaceName } from "../services/workspace.service";

const googleClient = new OAuth2Client(
  config.google.clientId,
  config.google.clientSecret,
  config.google.redirectUri
);

const isProduction = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

async function findOrCreateUser(email: string, name?: string) {
  const user = await upsertUserByEmail(email, name);
  const workspaceId = await ensureUserHasWorkspace(user.id, defaultWorkspaceName(user.name ?? name, email));
  await ensureUserHasFirstTeam(user.id, workspaceId);
  return user;
}

async function upsertUserByEmail(email: string, name?: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (name && name !== existing.name) await prisma.user.update({ where: { id: existing.id }, data: { name } });
    return existing;
  }
  const freePlanId = await resolveFreePlanId();
  return prisma.user.create({ data: { email, name, currentPlanId: freePlanId } });
}

async function resolveFreePlanId(): Promise<string> {
  const free = await prisma.plan.findUniqueOrThrow({ where: { slug: "free" }, select: { id: true } });
  return free.id;
}

export async function getAuthUrls(_req: Request, res: Response) {
  const googleUrl = googleClient.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
  });
  const state = Buffer.from(JSON.stringify({ flow: "sso" })).toString("base64url");
  const msParams = new URLSearchParams({
    client_id: config.microsoft.clientId,
    response_type: "code",
    redirect_uri: config.microsoft.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SSO_SCOPES.join(" "),
    state,
  });
  const microsoftUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${msParams}`;
  res.json({ google: googleUrl, microsoft: microsoftUrl });
}

export async function googleCallback(req: Request, res: Response) {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }
  const { tokens } = await googleClient.getToken(code);
  const ticket = await googleClient.verifyIdToken({
    idToken: tokens.id_token!,
    audience: config.google.clientId,
  });
  const payload = ticket.getPayload()!;

  if (!payload.email) {
    res.status(400).json({ error: "Email not provided by Google" });
    return;
  }

  const user = await findOrCreateUser(payload.email, payload.name);

  const token = signToken({ userId: user.id, email: user.email });
  res.cookie("token", token, cookieOptions);
  res.redirect(config.frontendUrl);
}

// ── Microsoft callback: dispatches on state param ──────────────────

export async function microsoftCallback(req: Request, res: Response) {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }

  const stateRaw = req.query.state as string | undefined;
  let flow = "sso";
  let teamId: string | undefined;
  if (stateRaw) {
    try {
      const parsed = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
      flow = parsed.flow ?? "sso";
      teamId = parsed.teamId;
    } catch {
      // unparseable state — default to SSO
    }
  }

  if (flow === "mailbox" && teamId) {
    return handleMailboxCallback(req, res, code, teamId);
  }
  return handleSsoCallback(res, code);
}

async function handleSsoCallback(res: Response, code: string) {
  const tokens = await exchangeCodeForTokens(code, MICROSOFT_SSO_SCOPES);
  if (!tokens.id_token) {
    res.status(400).json({ error: "No ID token returned by Microsoft" });
    return;
  }
  const claims = decodeIdToken(tokens.id_token);
  const email = claims.email ?? claims.preferred_username;
  const name = claims.name;
  if (!email) {
    res.status(400).json({ error: "Email not provided by Microsoft" });
    return;
  }
  const user = await findOrCreateUser(email, name);
  const jwt = signToken({ userId: user.id, email: user.email });
  res.cookie("token", jwt, cookieOptions);
  res.redirect(config.frontendUrl);
}

async function handleMailboxCallback(req: Request, res: Response, code: string, teamId: string) {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ error: "Authentication required to connect mailbox" });
    return;
  }

  let user: ReturnType<typeof verifyToken>;
  try {
    user = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const tokens = await exchangeCodeForTokens(code);
  if (!tokens.id_token) {
    res.status(400).json({ error: "No ID token returned by Microsoft" });
    return;
  }
  const claims = decodeIdToken(tokens.id_token);
  const email = claims.email ?? claims.preferred_username;
  if (!email) {
    res.status(400).json({ error: "Email not provided by Microsoft" });
    return;
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  try {
    await assertMailboxLimitOnCreate(teamId, email);
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.statusCode).json(err.body ?? { error: err.message });
      return;
    }
    throw err;
  }
  const emailAccount = await prisma.emailAccount.upsert({
    where: {
      provider_emailAddress_teamId: {
        provider: "MICROSOFT",
        emailAddress: email,
        teamId: teamId,
      },
    },
    update: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      tokenExpiresAt: expiresAt,
    },
    create: {
      userId: user.userId,
      teamId: teamId,
      provider: "MICROSOFT",
      emailAddress: email,
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      tokenExpiresAt: expiresAt,
    },
  });

  syncMailbox(emailAccount.id).catch(console.error);
  res.redirect(`${config.frontendUrl}/settings/mailbox?connected=true`);
}

async function assertMailboxLimitOnCreate(teamId: string, emailAddress: string): Promise<void> {
  const existing = await prisma.emailAccount.findUnique({
    where: { provider_emailAddress_teamId: { provider: "MICROSOFT", emailAddress, teamId: teamId } },
    select: { id: true },
  });
  if (existing) return;
  const org = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { workspaceId: true } });
  const currentCount = await prisma.emailAccount.count({ where: { team: { workspaceId: org.workspaceId } } });
  await assertWithinLimit(org.workspaceId, "mailbox_limit", currentCount);
}

// ── Mailbox connect URL (authenticated endpoint) ───────────────────

export async function getMailboxConnectUrl(req: Request, res: Response) {
  const state = Buffer.from(JSON.stringify({ flow: "mailbox", teamId: req.team!.teamId })).toString("base64url");
  const msParams = new URLSearchParams({
    client_id: config.microsoft.clientId,
    response_type: "code",
    redirect_uri: config.microsoft.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
    prompt: "consent",
  });
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${msParams}`;
  res.json({ url });
}

// ── Session endpoints ──────────────────────────────────────────────

export async function logout(_req: Request, res: Response) {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
}

export async function me(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          emailAccounts: {
            where: { userId: user.id },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    teams: memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      role: m.role,
      mailboxConnected: m.team.emailAccounts.length > 0,
    })),
  });
}

export async function devSeed(_req: Request, res: Response) {
  const freePlanId = await resolveFreePlanId();
  const user = await prisma.user.upsert({
    where: { email: "test@watchlane.dev" },
    update: {},
    create: { email: "test@watchlane.dev", name: "Test User", currentPlanId: freePlanId },
  });
  const workspace = await prisma.workspace.upsert({
    where: { id: "test-workspace-id" },
    update: {},
    create: { id: "test-workspace-id", name: "Test Workspace", ownerUserId: user.id },
  });
  const org = await prisma.team.upsert({
    where: { id: "test-org-id" },
    update: {},
    create: { id: "test-org-id", name: "Test Team", workspaceId: workspace.id },
  });
  await prisma.teamMember.upsert({
    where: { userId_teamId: { userId: user.id, teamId: org.id } },
    update: {},
    create: { userId: user.id, teamId: org.id, role: "OWNER" },
  });
  const token = signToken({ userId: user.id, email: user.email });
  res.cookie("token", token, cookieOptions);
  res.json({ message: "Seeded test user + workspace + org", user: { id: user.id, email: user.email } });
}
