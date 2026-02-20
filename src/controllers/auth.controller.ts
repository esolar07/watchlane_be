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

const googleClient = new OAuth2Client(
  config.google.clientId,
  config.google.clientSecret,
  config.google.redirectUri
);

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

async function findOrCreateUser(email: string, name?: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (name) {
      await prisma.user.update({ where: { email }, data: { name } });
    }
    return existing;
  }
  return prisma.user.create({ data: { email, name } });
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
  let inviteCode: string | undefined;
  if (stateRaw) {
    try {
      const parsed = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
      flow = parsed.flow ?? "sso";
      inviteCode = parsed.inviteCode;
    } catch {
      // unparseable state — default to SSO
    }
  }

  if (flow === "mailbox") {
    return handleMailboxCallback(req, res, code);
  }
  if (flow === "invite" && inviteCode) {
    return handleInviteCallback(res, code, inviteCode);
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

async function handleMailboxCallback(req: Request, res: Response, code: string) {
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
  const emailAccount = await prisma.emailAccount.upsert({
    where: {
      provider_emailAddress: {
        provider: "MICROSOFT",
        emailAddress: email,
      },
    },
    update: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      tokenExpiresAt: expiresAt,
    },
    create: {
      userId: user.userId,
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

async function handleInviteCallback(res: Response, code: string, inviteCode: string) {
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

  const org = await prisma.organization.findUnique({ where: { inviteCode } });
  if (!org) {
    res.status(400).json({ error: "Invalid invite code" });
    return;
  }

  const user = await findOrCreateUser(email, name);

  const existingMembership = await prisma.organizationMember.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
  });

  if (!existingMembership) {
    await prisma.organizationMember.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        role: "MEMBER",
      },
    });
  }

  const jwt = signToken({ userId: user.id, email: user.email });
  res.cookie("token", jwt, cookieOptions);
  res.redirect(config.frontendUrl);
}

// ── Invite URL (unauthenticated endpoint) ───────────────────────────

export async function getInviteAuthUrl(req: Request, res: Response) {
  const inviteCode = req.query.inviteCode as string | undefined;
  if (!inviteCode) {
    res.status(400).json({ error: "inviteCode query parameter is required" });
    return;
  }

  const org = await prisma.organization.findUnique({ where: { inviteCode } });
  if (!org) {
    res.status(404).json({ error: "Invalid invite code" });
    return;
  }

  const state = Buffer.from(JSON.stringify({ flow: "invite", inviteCode })).toString("base64url");
  const msParams = new URLSearchParams({
    client_id: config.microsoft.clientId,
    response_type: "code",
    redirect_uri: config.microsoft.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SSO_SCOPES.join(" "),
    state,
  });
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${msParams}`;
  res.json({ url, organizationName: org.name });
}

// ── Mailbox connect URL (authenticated endpoint) ───────────────────

export async function getMailboxConnectUrl(_req: Request, res: Response) {
  const state = Buffer.from(JSON.stringify({ flow: "mailbox" })).toString("base64url");
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
  const memberships = await prisma.organizationMember.findMany({
    where: { userId: user.id },
    include: { organization: { select: { id: true, name: true } } },
  });

  res.json({
    user,
    organizations: memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      role: m.role,
    })),
  });
}

export async function devSeed(_req: Request, res: Response) {
  const user = await prisma.user.upsert({
    where: { email: "test@watchlane.dev" },
    update: {},
    create: { email: "test@watchlane.dev", name: "Test User" },
  });

  const org = await prisma.organization.upsert({
    where: { id: "test-org-id" },
    update: {},
    create: { id: "test-org-id", name: "Test Organization" },
  });

  await prisma.organizationMember.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: org.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      organizationId: org.id,
      role: "OWNER",
    },
  });

  const token = signToken({ userId: user.id, email: user.email });
  res.cookie("token", token, cookieOptions);
  res.json({ message: "Seeded test user + org", user: { id: user.id, email: user.email } });
}
