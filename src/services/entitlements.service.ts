import { prisma } from "../lib/prisma";
import {
  PlanFeatureKey,
  DecodedFeatures,
  DecodedFeature,
  PLAN_FEATURE_KEYS,
  decodeFeature,
  defaultFeatureValue,
  isLimitFeature,
} from "../config/plan-features";
import { FeatureNotAvailableError, LimitReachedError } from "../lib/errors";

export interface PlanIdentity {
  slug: string;
  name: string;
}

export interface Entitlements {
  plan: PlanIdentity;
  features: DecodedFeatures;
}

interface CacheEntry {
  expiresAt: number;
  entitlements: Entitlements;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function cacheGet(workspaceId: string): Entitlements | null {
  const entry = cache.get(workspaceId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) { cache.delete(workspaceId); return null; }
  return entry.entitlements;
}

function cacheSet(workspaceId: string, entitlements: Entitlements): void {
  cache.set(workspaceId, { expiresAt: Date.now() + CACHE_TTL_MS, entitlements });
}

export function invalidate(workspaceId: string): void {
  cache.delete(workspaceId);
}

export async function invalidateForUser(userId: string): Promise<void> {
  const owned = await prisma.workspace.findMany({ where: { ownerUserId: userId }, select: { id: true } });
  owned.forEach((w) => cache.delete(w.id));
}

export function invalidateAll(): void {
  cache.clear();
}

function buildFeatures(rows: { key: string; value: string }[]): DecodedFeatures {
  const features: Record<string, unknown> = {};
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  for (const key of PLAN_FEATURE_KEYS) {
    const raw = byKey.get(key);
    features[key] = raw === undefined ? defaultFeatureValue(key) : decodeFeature(key, raw);
  }
  return features as DecodedFeatures;
}

const PLAN_WITH_FEATURES_SELECT = { slug: true, name: true, features: { select: { key: true, value: true } } } as const;

function shapeEntitlements(plan: { slug: string; name: string; features: { key: string; value: string }[] }): Entitlements {
  return { plan: { slug: plan.slug, name: plan.name }, features: buildFeatures(plan.features) };
}

async function loadEntitlements(workspaceId: string): Promise<Entitlements> {
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { owner: { select: { currentPlan: { select: PLAN_WITH_FEATURES_SELECT } } } },
  });
  return shapeEntitlements(ws.owner.currentPlan);
}

async function loadEntitlementsByUser(userId: string): Promise<Entitlements> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { currentPlan: { select: PLAN_WITH_FEATURES_SELECT } },
  });
  return shapeEntitlements(user.currentPlan);
}

export async function getEntitlements(workspaceId: string): Promise<Entitlements> {
  const cached = cacheGet(workspaceId);
  if (cached) return cached;
  const entitlements = await loadEntitlements(workspaceId);
  cacheSet(workspaceId, entitlements);
  return entitlements;
}

export async function getEntitlementsByOrg(teamId: string): Promise<Entitlements> {
  const org = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { workspaceId: true } });
  return getEntitlements(org.workspaceId);
}

export async function getFeature<K extends PlanFeatureKey>(workspaceId: string, key: K): Promise<DecodedFeature<K>> {
  const entitlements = await getEntitlements(workspaceId);
  return entitlements.features[key];
}

export async function hasFeature(workspaceId: string, key: PlanFeatureKey): Promise<boolean> {
  const value = await getFeature(workspaceId, key);
  return value === true;
}

export async function assertFeature(workspaceId: string, key: PlanFeatureKey): Promise<void> {
  const entitlements = await getEntitlements(workspaceId);
  if (entitlements.features[key] !== true) throw new FeatureNotAvailableError(key, entitlements.plan.slug);
}

export async function assertWithinLimit(workspaceId: string, key: PlanFeatureKey, currentCount: number): Promise<void> {
  if (!isLimitFeature(key)) throw new Error(`Feature "${key}" is not a limit feature`);
  const limit = await getFeature(workspaceId, key);
  enforceLimit(key, limit as unknown as number | null, currentCount);
}

export async function getEntitlementsByUser(userId: string): Promise<Entitlements> {
  return loadEntitlementsByUser(userId);
}

export async function assertWithinLimitForUser(userId: string, key: PlanFeatureKey, currentCount: number): Promise<void> {
  if (!isLimitFeature(key)) throw new Error(`Feature "${key}" is not a limit feature`);
  const entitlements = await getEntitlementsByUser(userId);
  enforceLimit(key, entitlements.features[key] as unknown as number | null, currentCount);
}

function enforceLimit(key: PlanFeatureKey, limit: number | null, currentCount: number): void {
  if (limit === null) return;
  if (currentCount >= limit) throw new LimitReachedError(key, limit, currentCount);
}
