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

async function loadEntitlements(workspaceId: string): Promise<Entitlements> {
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { currentPlan: { select: { slug: true, name: true, features: { select: { key: true, value: true } } } } },
  });
  const plan = ws.currentPlan;
  return { plan: { slug: plan.slug, name: plan.name }, features: buildFeatures(plan.features) };
}

export async function getEntitlements(workspaceId: string): Promise<Entitlements> {
  const cached = cacheGet(workspaceId);
  if (cached) return cached;
  const entitlements = await loadEntitlements(workspaceId);
  cacheSet(workspaceId, entitlements);
  return entitlements;
}

export async function getEntitlementsByOrg(organizationId: string): Promise<Entitlements> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { workspaceId: true } });
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
  if (limit === null) return;
  if (typeof limit === "number" && currentCount >= limit) throw new LimitReachedError(key, limit, currentCount);
}
