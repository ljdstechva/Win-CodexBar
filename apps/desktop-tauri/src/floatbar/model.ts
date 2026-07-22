import type {
  ProviderUsageSnapshot,
  RateWindowSnapshot,
} from "../types/bridge";
import { displayPlanName } from "../lib/providerPlan";

export const FLOAT_BAR_NO_VALUE = "—";
export const FIVE_HOUR_WINDOW_MINUTES = 5 * 60;
export const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;

export type FloatBarTone = "green" | "yellow" | "orange" | "red";

export interface FloatBarWindows {
  fiveHour: RateWindowSnapshot | null;
  sevenDay: RateWindowSnapshot | null;
}

export interface AccountSummary {
  planLabel: string;
  endsAt: string | null;
}

const IDENTITY_BACKED_PLAN_FIELDS = new Set(["deepgram", "vertexai"]);
const EMAIL_LIKE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const MONETARY_VALUE =
  /(?:[$€£¥₹₱]\s*\d)|(?:\b\d+(?:[.,]\d+)?\s*(?:usd|eur|gbp|jpy|inr|php)\b)/i;
const NON_PLAN_METADATA =
  /\b(?:active|available|balance|billing|configured|console|cost|credits?|credentials?|deployment|inactive|installed|keys?|metrics?|models?|oauth|projects?|remaining|spend|status|tokens?|top[- ]?up|units?|until|workspaces?)\b|\bapi(?:\s+keys?)?\b|\bcli\b/i;

function safeFloatBarPlanLabel(
  provider: ProviderUsageSnapshot,
  claudeAiLabel = "Claude AI",
): string | null {
  const label = displayPlanName(provider.planName, claudeAiLabel);
  if (!label || label.length > 64 || /[\r\n\t]/.test(label)) return null;

  const lower = label.toLocaleLowerCase();
  const matchesPrivateField = [
    provider.accountEmail,
    provider.accountOrganization,
  ].some((value) => {
    const privateValue = value?.trim().toLocaleLowerCase();
    return !!privateValue && lower.includes(privateValue);
  });
  const repeatsProviderName =
    lower === provider.displayName.trim().toLocaleLowerCase();
  // Alibaba's provider-owned plan label is literally "Token Plan <tier>".
  // Ignore only that leading product phrase when screening the remainder;
  // email, money, balance, and every other metadata guard still applies.
  const metadataLabel =
    provider.providerId === "alibabatokenplan"
      ? label.replace(/^token\s+plan\b/i, "")
      : label;

  if (
    matchesPrivateField ||
    repeatsProviderName ||
    IDENTITY_BACKED_PLAN_FIELDS.has(provider.providerId) ||
    EMAIL_LIKE.test(label) ||
    MONETARY_VALUE.test(label) ||
    NON_PLAN_METADATA.test(metadataLabel) ||
    /(?:https?:\/\/|www\.)/i.test(label)
  ) {
    return null;
  }

  if (provider.providerId === "chatgpt" && !/^chatgpt\b/i.test(label)) {
    return `ChatGPT ${label}`;
  }

  return label;
}

/** Derive only non-personal account data suitable for the no-activate overlay. */
export function accountSummary(
  provider: ProviderUsageSnapshot,
  now: Date = new Date(),
  claudeAiLabel = "Claude AI",
): AccountSummary | null {
  // `login_method` predates the plan badge and several providers overload it
  // with identity, auth method, balance, or project metadata. Keep that legacy
  // bridge field intact, but admit only plan-like, non-personal labels here.
  const planLabel = safeFloatBarPlanLabel(provider, claudeAiLabel);
  const expiryMs = provider.subscriptionEndsAt
    ? Date.parse(provider.subscriptionEndsAt)
    : Number.NaN;
  const endsAt =
    !Number.isNaN(expiryMs) && expiryMs > now.getTime()
      ? provider.subscriptionEndsAt
      : null;

  if (!planLabel && !endsAt) return null;
  return { planLabel: planLabel ?? FLOAT_BAR_NO_VALUE, endsAt };
}

/** Hide an expiry-only account once that genuine timestamp is no longer future. */
export function hasVisibleAccountSummary(
  summary: AccountSummary,
  now: Date,
): boolean {
  if (summary.planLabel !== FLOAT_BAR_NO_VALUE) return true;
  if (!summary.endsAt) return false;

  const expiryMs = Date.parse(summary.endsAt);
  return !Number.isNaN(expiryMs) && expiryMs > now.getTime();
}

/** Keep provider identity stable when an account has the same provider id. */
export function providerKey(provider: ProviderUsageSnapshot): string {
  return `${provider.providerId}:${provider.accountEmail ?? ""}`;
}

export function inlineResetTime(resetText: string): string {
  const normalized = resetText.trim();
  if (/^reset(?:s|ting)?(?:\s+due)?\s*(?:now)?$/i.test(normalized)) {
    return "now";
  }
  return normalized
    .replace(/^resets?\s+in\s+/i, "")
    .replace(/^resets?\s+/i, "")
    .trim();
}

export function remainingTone(
  remainingPercent: number,
  exhausted = false,
): FloatBarTone {
  if (exhausted || remainingPercent < 10) return "red";
  if (remainingPercent < 30) return "orange";
  if (remainingPercent < 50) return "yellow";
  return "green";
}

/** Return Claude's scoped Fable-only quota without fabricating it elsewhere. */
export function fableOnlyWindow(
  provider: ProviderUsageSnapshot,
): RateWindowSnapshot | null {
  if (provider.providerId !== "claude") return null;

  return (
    provider.extraRateWindows.find((extra) => {
      const stableId = /(?:^|[-_./])fable(?:$|[-_./])/i.test(extra.id);
      const compatibleTitle = /^fable(?:\s+only)?$/i.test(extra.title.trim());
      return !extra.window.isInformational && (stableId || compatibleTitle);
    })?.window ?? null
  );
}

function isWeeklyWindow(window: RateWindowSnapshot | null): boolean {
  return window?.windowMinutes === WEEKLY_WINDOW_MINUTES;
}

function availableWindow(
  window: RateWindowSnapshot | null | undefined,
): RateWindowSnapshot | null {
  return window && !window.isInformational ? window : null;
}

/** Map provider windows to the labels the FloatBar promises to show. */
export function classifyFloatBarWindows(
  provider: ProviderUsageSnapshot,
): FloatBarWindows {
  const candidates = [
    availableWindow(provider.primary),
    availableWindow(provider.secondary),
  ].filter((window): window is RateWindowSnapshot => window !== null);

  return {
    fiveHour:
      candidates.find(
        (window) => window.windowMinutes === FIVE_HOUR_WINDOW_MINUTES,
      ) ?? null,
    sevenDay: candidates.find((window) => isWeeklyWindow(window)) ?? null,
  };
}

/** Apply the FloatBar allow-list and preserve its highest-use-first order. */
export function selectVisibleProviders(
  providers: readonly ProviderUsageSnapshot[],
  enabledProviderIds: readonly string[],
  filterIds?: readonly string[] | null,
): ProviderUsageSnapshot[] {
  const enabled = new Set(enabledProviderIds);
  const wanted = filterIds && filterIds.length > 0 ? new Set(filterIds) : null;
  return providers
    .filter(
      (provider) =>
        enabled.has(provider.providerId) &&
        (!wanted || wanted.has(provider.providerId)),
    )
    .sort((a, b) => b.primary.usedPercent - a.primary.usedPercent);
}
