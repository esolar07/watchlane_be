import { randomBytes } from "crypto";

const INVITE_TOKEN_BYTE_LENGTH = 32;

export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTE_LENGTH).toString("base64url");
}
