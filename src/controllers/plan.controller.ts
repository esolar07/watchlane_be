import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { invalidateAll } from "../services/entitlements.service";
import { isKnownFeatureKey, PLAN_FEATURES, PlanFeatureKey } from "../config/plan-features";
import { PlanInUseError, PlanNotFoundError, ValidationError } from "../lib/errors";

const PLAN_INCLUDE = {
  features: { select: { key: true, value: true } },
} as const;

const SLUG_PATTERN = /^[a-z0-9_]+$/;

interface CreatePlanBody { slug: string; name: string; description?: string; sortOrder?: number; isActive?: boolean }
interface UpdatePlanBody { name?: string; description?: string; sortOrder?: number; isActive?: boolean }
interface UpsertFeaturesBody { features: Record<string, string | number | boolean | null> }

interface ShapedPlan { id: string; slug: string; name: string; description: string | null; isActive: boolean; sortOrder: number; features: { key: string; value: string }[] }

function shapePlan(plan: ShapedPlan) {
  return { id: plan.id, slug: plan.slug, name: plan.name, description: plan.description, isActive: plan.isActive, sortOrder: plan.sortOrder, features: plan.features };
}

export async function listPublicPlans(_req: Request, res: Response) {
  const plans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, include: PLAN_INCLUDE });
  res.json({ plans: plans.map(shapePlan) });
}

export async function listAdminPlans(_req: Request, res: Response) {
  const plans = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, include: PLAN_INCLUDE });
  res.json({ plans });
}

function validateCreatePlanBody(raw: unknown): CreatePlanBody {
  if (!raw || typeof raw !== "object") throw new ValidationError("Invalid request body");
  const body = raw as Partial<CreatePlanBody>;
  if (!body.slug || !SLUG_PATTERN.test(body.slug)) throw new ValidationError("slug must match /^[a-z0-9_]+$/");
  if (!body.name || typeof body.name !== "string") throw new ValidationError("name is required");
  return { slug: body.slug, name: body.name.trim(), description: body.description, sortOrder: body.sortOrder, isActive: body.isActive };
}

export async function createPlan(req: Request, res: Response) {
  const body = validateCreatePlanBody(req.body);
  const plan = await prisma.plan.create({
    data: { slug: body.slug, name: body.name, description: body.description ?? null, sortOrder: body.sortOrder ?? 0, isActive: body.isActive ?? true },
    include: PLAN_INCLUDE,
  });
  invalidateAll();
  res.status(201).json({ plan: shapePlan(plan) });
}

export async function updatePlan(req: Request<{ id: string }, {}, UpdatePlanBody>, res: Response) {
  const { id } = req.params;
  const { name, description, sortOrder, isActive } = req.body ?? {};
  const plan = await prisma.plan.update({
    where: { id },
    data: { ...(name !== undefined && { name: name.trim() }), ...(description !== undefined && { description }), ...(sortOrder !== undefined && { sortOrder }), ...(isActive !== undefined && { isActive }) },
    include: PLAN_INCLUDE,
  });
  invalidateAll();
  res.json({ plan: shapePlan(plan) });
}

async function assertPlanNotInUse(planId: string): Promise<void> {
  const userCount = await prisma.user.count({ where: { currentPlanId: planId } });
  if (userCount > 0) throw new PlanInUseError(planId);
}

export async function deletePlan(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  await assertPlanNotInUse(id);
  await prisma.plan.delete({ where: { id } });
  invalidateAll();
  res.status(204).end();
}

function normalizeFeatureValue(key: PlanFeatureKey, raw: unknown): string {
  const spec = PLAN_FEATURES[key];
  if (typeof raw === "string") { spec.decode(raw); return raw; }
  return spec.encode(raw as never);
}

function validateFeaturesBody(raw: unknown): { key: PlanFeatureKey; value: string }[] {
  if (!raw || typeof raw !== "object") throw new ValidationError("Invalid request body");
  const body = raw as Partial<UpsertFeaturesBody>;
  if (!body.features || typeof body.features !== "object") throw new ValidationError("features object is required");
  return Object.entries(body.features).map(([key, value]) => {
    if (!isKnownFeatureKey(key)) throw new ValidationError(`Unknown feature key: ${key}`);
    return { key, value: normalizeFeatureValue(key, value) };
  });
}

function upsertFeatureRow(planId: string, key: PlanFeatureKey, value: string) {
  return prisma.planFeature.upsert({ where: { planId_key: { planId, key } }, create: { planId, key, value }, update: { value } });
}

export async function upsertPlanFeatures(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) throw new PlanNotFoundError(id);
  const entries = validateFeaturesBody(req.body);
  await prisma.$transaction(entries.map(({ key, value }) => upsertFeatureRow(id, key, value)));
  invalidateAll();
  const features = await prisma.planFeature.findMany({ where: { planId: id }, select: { key: true, value: true } });
  res.json({ features });
}
