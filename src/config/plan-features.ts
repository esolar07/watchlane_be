export type IntOrUnlimited = number | null;
export const UNLIMITED_TOKEN = "unlimited" as const;

function decodeIntOrUnlimited(raw: string): IntOrUnlimited {
  if (raw === UNLIMITED_TOKEN) return null;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid integer feature value: "${raw}"`);
  return parsed;
}

function decodeBool(raw: string): boolean {
  return raw === "true";
}

function encodeIntOrUnlimited(value: IntOrUnlimited): string {
  return value === null ? UNLIMITED_TOKEN : String(value);
}

function encodeBool(value: boolean): string {
  return value ? "true" : "false";
}

export const PLAN_FEATURES = {
  mailbox_limit:     { decode: decodeIntOrUnlimited, encode: encodeIntOrUnlimited, defaultValue: 1 as IntOrUnlimited },
  org_limit:         { decode: decodeIntOrUnlimited, encode: encodeIntOrUnlimited, defaultValue: 1 as IntOrUnlimited },
  history_days:      { decode: decodeIntOrUnlimited, encode: encodeIntOrUnlimited, defaultValue: 7 as IntOrUnlimited },
  weekly_reports:    { decode: decodeBool,           encode: encodeBool,           defaultValue: false },
  folder_monitoring: { decode: decodeBool,           encode: encodeBool,           defaultValue: false },
  priority_support:  { decode: decodeBool,           encode: encodeBool,           defaultValue: false },
} as const;

export type PlanFeatureKey = keyof typeof PLAN_FEATURES;
export type DecodedFeature<K extends PlanFeatureKey> = ReturnType<(typeof PLAN_FEATURES)[K]["decode"]>;
export type DecodedFeatures = { [K in PlanFeatureKey]: DecodedFeature<K> };

export const PLAN_FEATURE_KEYS = Object.keys(PLAN_FEATURES) as PlanFeatureKey[];

export function isKnownFeatureKey(key: string): key is PlanFeatureKey {
  return key in PLAN_FEATURES;
}

export function decodeFeature<K extends PlanFeatureKey>(key: K, raw: string): DecodedFeature<K> {
  return PLAN_FEATURES[key].decode(raw) as DecodedFeature<K>;
}

export function defaultFeatureValue<K extends PlanFeatureKey>(key: K): DecodedFeature<K> {
  return PLAN_FEATURES[key].defaultValue as DecodedFeature<K>;
}

export function isLimitFeature(key: PlanFeatureKey): boolean {
  return PLAN_FEATURES[key].decode === decodeIntOrUnlimited;
}

export function isBooleanFeature(key: PlanFeatureKey): boolean {
  return PLAN_FEATURES[key].decode === decodeBool;
}
