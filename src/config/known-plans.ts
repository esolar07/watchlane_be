export const KNOWN_PLAN_SLUGS = ["free", "pro", "pro_plus", "enterprise"] as const;
export type KnownPlanSlug = (typeof KNOWN_PLAN_SLUGS)[number];

export function isKnownPlanSlug(slug: string): slug is KnownPlanSlug {
  return (KNOWN_PLAN_SLUGS as readonly string[]).includes(slug);
}
