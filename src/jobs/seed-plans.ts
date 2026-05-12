import { prisma } from "../lib/prisma";
import { PLAN_FEATURES, PlanFeatureKey } from "../config/plan-features";
import type { PlanInterval } from "../generated/prisma/client";

type PlanFeatureValues = Partial<{ [K in PlanFeatureKey]: string }>;

interface PlanSeed {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  features: PlanFeatureValues;
}

interface PriceSeed {
  planSlug: string;
  stripePriceId: string;
  interval: PlanInterval;
  unitAmount: number;
  currency?: string;
}

const PLAN_SEEDS: PlanSeed[] = [
  {
    slug: "free",
    name: "Free",
    description: "1 connected mailbox, up to 3 organizations, 7-day history.",
    sortOrder: 0,
    features: { mailbox_limit: "1", org_limit: "3", history_days: "7", weekly_reports: "false", folder_monitoring: "false", priority_support: "false" },
  },
  {
    slug: "pro",
    name: "Pro",
    description: "Up to 5 mailboxes across unlimited orgs, 90-day history, weekly reports, folder monitoring.",
    sortOrder: 1,
    features: { mailbox_limit: "5", org_limit: "unlimited", history_days: "90", weekly_reports: "true", folder_monitoring: "true", priority_support: "false" },
  },
  {
    slug: "pro_plus",
    name: "Pro+",
    description: "Unlimited mailboxes and orgs, unlimited history, priority support.",
    sortOrder: 2,
    features: { mailbox_limit: "unlimited", org_limit: "unlimited", history_days: "unlimited", weekly_reports: "true", folder_monitoring: "true", priority_support: "true" },
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    description: "Everything in Pro+ with custom contract.",
    sortOrder: 3,
    features: { mailbox_limit: "unlimited", org_limit: "unlimited", history_days: "unlimited", weekly_reports: "true", folder_monitoring: "true", priority_support: "true" },
  },
];

async function upsertPlan(seed: PlanSeed): Promise<string> {
  const plan = await prisma.plan.upsert({
    where: { slug: seed.slug },
    create: { slug: seed.slug, name: seed.name, description: seed.description, sortOrder: seed.sortOrder, isActive: true },
    update: { name: seed.name, description: seed.description, sortOrder: seed.sortOrder },
  });
  return plan.id;
}

async function upsertFeature(planId: string, key: PlanFeatureKey, value: string): Promise<void> {
  await prisma.planFeature.upsert({
    where: { planId_key: { planId, key } },
    create: { planId, key, value },
    update: { value },
  });
}

async function seedPlanWithFeatures(seed: PlanSeed): Promise<void> {
  const planId = await upsertPlan(seed);
  for (const [key, value] of Object.entries(seed.features)) {
    if (!(key in PLAN_FEATURES)) continue;
    await upsertFeature(planId, key as PlanFeatureKey, value);
  }
}

async function upsertPrice(seed: PriceSeed): Promise<void> {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: seed.planSlug } });
  await prisma.planPrice.upsert({
    where: { stripePriceId: seed.stripePriceId },
    create: { planId: plan.id, stripePriceId: seed.stripePriceId, interval: seed.interval, unitAmount: seed.unitAmount, currency: seed.currency ?? "usd" },
    update: { planId: plan.id, interval: seed.interval, unitAmount: seed.unitAmount, currency: seed.currency ?? "usd" },
  });
}

export async function seedPlans(prices: PriceSeed[] = []): Promise<void> {
  for (const seed of PLAN_SEEDS) await seedPlanWithFeatures(seed);
  for (const price of prices) await upsertPrice(price);
}

if (require.main === module) {
  seedPlans()
    .then(() => { console.log("Plans seeded"); process.exit(0); })
    .catch((err) => { console.error("Seed failed:", err); process.exit(1); });
}
