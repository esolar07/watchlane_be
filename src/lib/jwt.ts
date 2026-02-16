import jwt from "jsonwebtoken";
import { config } from "../config/env";
import type { JwtPayload } from "../types/auth";

export function signToken(payload: {
  userId: string;
  email: string;
}): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}
