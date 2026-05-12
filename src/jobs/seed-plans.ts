import { prisma } from "../lib/prisma";
import { PLAN_FEATURES, PlanFeatureKey } from "../config/plan-features";

type PlanFeatureValues = Partial<{ [K in PlanFeatureKey]: string }>;

interface PlanSeed {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  features: PlanFeatureValues;
}

const PLAN_SEEDS: PlanSeed[] = [
  {
    slug: "free",
    name: "Free",
    description: "Up to 3 workspaces, 1 team and 1 mailbox per workspace, 7-day history.",
    sortOrder: 0,
    features: { workspace_limit: "3", mailbox_limit: "1", team_limit: "1", history_days: "7", weekly_reports: "false", folder_monitoring: "false", priority_support: "false" },
  },
  {
    slug: "pro",
    name: "Pro",
    description: "Unlimited workspaces, 5 mailboxes per workspace, 90-day history, weekly reports, folder monitoring.",
    sortOrder: 1,
    features: { workspace_limit: "unlimited", mailbox_limit: "5", team_limit: "unlimited", history_days: "90", weekly_reports: "true", folder_monitoring: "true", priority_support: "false" },
  },
  {
    slug: "pro_plus",
    name: "Pro+",
    description: "Unlimited everything, unlimited history, priority support.",
    sortOrder: 2,
    features: { workspace_limit: "unlimited", mailbox_limit: "unlimited", team_limit: "unlimited", history_days: "unlimited", weekly_reports: "true", folder_monitoring: "true", priority_support: "true" },
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    description: "Everything in Pro+ with custom contract.",
    sortOrder: 3,
    features: { workspace_limit: "unlimited", mailbox_limit: "unlimited", team_limit: "unlimited", history_days: "unlimited", weekly_reports: "true", folder_monitoring: "true", priority_support: "true" },
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

export async function seedPlans(): Promise<void> {
  for (const seed of PLAN_SEEDS) await seedPlanWithFeatures(seed);
}

if (require.main === module) {
  seedPlans()
    .then(() => { console.log("Plans seeded"); process.exit(0); })
    .catch((err) => { console.error("Seed failed:", err); process.exit(1); });
}
