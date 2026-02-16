import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import {
  ConfidentialClientApplication,
  type Configuration,
} from "@azure/msal-node";
import { config } from "../config/env";
import { prisma } from "../lib/prisma";
import { signToken } from "../lib/jwt";

// --- Google OAuth setup ---

const googleClient = new OAuth2Client(
  config.google.clientId,
  config.google.clientSecret,
  config.google.redirectUri
);

// --- Microsoft OAuth setup ---

const msalConfig: Configuration = {
  auth: {
    clientId: config.microsoft.clientId,
    clientSecret: config.microsoft.clientSecret,
    authority: "https://login.microsoftonline.com/common",
  },
};

const msalClient = new ConfidentialClientApplication(msalConfig);

// --- Cookie options ---

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// --- Controllers ---

export async function getAuthUrls(_req: Request, res: Response) {
  const googleUrl = googleClient.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
  });

  const microsoftUrl = await msalClient.getAuthCodeUrl({
    scopes: ["openid", "email", "profile"],
    redirectUri: config.microsoft.redirectUri,
  });

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

  const user = await prisma.user.upsert({
    where: { email: payload.email },
    update: { name: payload.name },
    create: {
      email: payload.email,
      name: payload.name,
    },
  });

  const token = signToken({ userId: user.id, email: user.email });
  res.cookie("token", token, cookieOptions);
  res.redirect(config.frontendUrl);
}

export async function microsoftCallback(req: Request, res: Response) {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }

  const result = await msalClient.acquireTokenByCode({
    code,
    scopes: ["openid", "email", "profile"],
    redirectUri: config.microsoft.redirectUri,
  });

  const email =
    result.account?.username ?? (result.idTokenClaims as any)?.email;
  const name =
    result.account?.name ?? (result.idTokenClaims as any)?.name;

  if (!email) {
    res.status(400).json({ error: "Email not provided by Microsoft" });
    return;
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name },
  });

  const token = signToken({ userId: user.id, email: user.email });
  res.cookie("token", token, cookieOptions);
  res.redirect(config.frontendUrl);
}

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
