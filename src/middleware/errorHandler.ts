import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../lib/errors";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json(err.body ?? { error: err.message });
    return;
  }
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
}
