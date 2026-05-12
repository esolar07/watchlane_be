import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { EvaluationType, RuleScopeKind } from "../generated/prisma/client";

interface CreateRuleBody {
  name: string;
  evaluationType: EvaluationType;
  scopeKind: RuleScopeKind;
  threshold?: number | null;
  config?: Record<string, unknown>;
  active?: boolean;
  emailAccountId?: string | null;
  folderId?: string | null;
}

export async function listRules(req: Request, res: Response) {
  if (!req.team) {
    res.status(403).json({ error: "Team context required" });
    return;
  }
  const rules = await prisma.monitoringRule.findMany({
    where: { teamId: req.team.teamId },
    include: {
      emailAccount: { select: { id: true, emailAddress: true } },
      folder: { select: { id: true, name: true, path: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  res.json({ rules });
}

export async function createRule(req: Request, res: Response) {
  if (!req.team) {
    res.status(403).json({ error: "Team context required" });
    return;
  }
  const parsed = parseCreateRuleBody(req.body);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const scopeError = await validateRuleScope(parsed.body!, req.team.teamId);
  if (scopeError) {
    res.status(400).json({ error: scopeError });
    return;
  }
  const rule = await prisma.monitoringRule.create({ data: buildRuleCreateData(parsed.body!, req.team.teamId) });
  res.status(201).json({ rule });
}

function parseCreateRuleBody(raw: unknown): { body?: CreateRuleBody; error?: string } {
  if (!raw || typeof raw !== "object") return { error: "Invalid request body" };
  const body = raw as Partial<CreateRuleBody>;
  if (!body.name || typeof body.name !== "string") return { error: "name is required" };
  if (!body.evaluationType) return { error: "evaluationType is required" };
  if (!body.scopeKind) return { error: "scopeKind is required" };
  return { body: body as CreateRuleBody };
}

async function validateRuleScope(body: CreateRuleBody, teamId: string): Promise<string | null> {
  if (body.scopeKind === "TEAM") return validateTeamScope(body);
  if (body.scopeKind === "ACCOUNT") return validateAccountScope(body, teamId);
  return validateFolderScope(body, teamId);
}

function validateTeamScope(body: CreateRuleBody): string | null {
  if (body.emailAccountId || body.folderId) return "ORGANIZATION scope must not include emailAccountId or folderId";
  return null;
}

async function validateAccountScope(body: CreateRuleBody, teamId: string): Promise<string | null> {
  if (!body.emailAccountId) return "ACCOUNT scope requires emailAccountId";
  if (body.folderId) return "ACCOUNT scope must not include folderId";
  const account = await prisma.emailAccount.findUnique({ where: { id: body.emailAccountId } });
  if (!account || account.teamId !== teamId) return "emailAccount not found in this team";
  return null;
}

async function validateFolderScope(body: CreateRuleBody, teamId: string): Promise<string | null> {
  if (!body.emailAccountId || !body.folderId) return "FOLDER scope requires emailAccountId and folderId";
  const folder = await prisma.emailFolder.findUnique({ where: { id: body.folderId } });
  if (!folder || folder.emailAccountId !== body.emailAccountId) return "folder does not belong to the given emailAccount";
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: body.emailAccountId } });
  if (account.teamId !== teamId) return "emailAccount not found in this team";
  return null;
}

function buildRuleCreateData(body: CreateRuleBody, teamId: string) {
  return {
    teamId,
    name: body.name,
    evaluationType: body.evaluationType,
    threshold: body.threshold ?? null,
    config: (body.config ?? {}) as object,
    active: body.active ?? true,
    scopeKind: body.scopeKind,
    emailAccountId: body.emailAccountId ?? null,
    folderId: body.folderId ?? null,
  };
}
