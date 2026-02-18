import { config } from "../config/env";
import { prisma } from "./prisma";
import { encrypt, decrypt } from "./encryption";

const TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export const MICROSOFT_SSO_SCOPES = ["openid", "email", "profile"];

export const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "Mail.Read",
];

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}

interface MicrosoftIdTokenClaims {
  email?: string;
  preferred_username?: string;
  name?: string;
  sub: string;
}


export async function exchangeCodeForTokens(
  code: string,
  scopes?: string[]
): Promise<MicrosoftTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.microsoft.clientId,
    client_secret: config.microsoft.clientSecret,
    code,
    redirect_uri: config.microsoft.redirectUri,
    grant_type: "authorization_code",
    scope: (scopes ?? MICROSOFT_SCOPES).join(" "),
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Microsoft token exchange failed: ${error}`);
  }

  return res.json() as Promise<MicrosoftTokenResponse>;
}


export async function refreshAccessToken(
  refreshToken: string
): Promise<MicrosoftTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.microsoft.clientId,
    client_secret: config.microsoft.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MICROSOFT_SCOPES.join(" "),
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Microsoft token refresh failed: ${error}`);
  }

  return res.json() as Promise<MicrosoftTokenResponse>;
}


export function decodeIdToken(idToken: string): MicrosoftIdTokenClaims {
  const payload = idToken.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}


export async function getValidAccessToken(
  emailAccountId: string
): Promise<string> {
  const account = await prisma.emailAccount.findUniqueOrThrow({
    where: { id: emailAccountId },
  });

  const isExpired =
    !account.tokenExpiresAt ||
    account.tokenExpiresAt.getTime() < Date.now() + 60_000; // 1min buffer

  if (!isExpired) {
    return decrypt(account.accessToken);
  }

  if (!account.refreshToken) {
    throw new Error("Access token expired and no refresh token available");
  }

  const tokens = await refreshAccessToken(decrypt(account.refreshToken));
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await prisma.emailAccount.update({
    where: { id: emailAccountId },
    data: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : undefined,
      tokenExpiresAt: expiresAt,
    },
  });

  return tokens.access_token;
}
