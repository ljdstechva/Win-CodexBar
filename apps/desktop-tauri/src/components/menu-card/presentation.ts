import type {
  PaceSnapshot,
  ProviderUsageSnapshot,
  RateWindowSnapshot,
} from "../../types/bridge";
import type { LocaleKey } from "../../i18n/keys";
import { getPaceBudget } from "../../lib/paceBudget";
import {
  formatPaceDuration,
  formatRateNumber,
  type LivePace,
  type PaceVerdict,
} from "../../lib/paceRate";
export { displayPlanName } from "../../lib/providerPlan";

export type Translate = (key: LocaleKey) => string;

export interface MetricEntry {
  id: string;
  label: string;
  snap: RateWindowSnapshot;
}

export interface PaceEntry {
  id: "primary" | "weekly";
  label: string;
  pace: PaceSnapshot;
  /** The rate window the pace was computed from, for live per-minute updates. */
  snap: RateWindowSnapshot | null;
  /** Window length assumed when the snapshot omits its duration. */
  defaultWindowMinutes: number;
}

/** Color tone for the pace coaching line; reuses the pace badge palette. */
export type PaceTone = "idle" | "steady" | "racing" | "burning";

export interface PaceAdvice {
  verdict: PaceVerdict;
  tone: PaceTone;
  lead: string;
  message: string;
  rateText: string;
  safeRateText: string;
  rateHint: string;
  safeRateHint: string;
}

export type UsageLevel = "normal" | "high" | "critical" | "exhausted";

export type MetricPaceView =
  | { kind: "budget"; budget: NonNullable<ReturnType<typeof getPaceBudget>> }
  | { kind: "reserve"; percent: number }
  | { kind: "none" };

const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;

export const maskEmail = (email: string): string => {
  const at = email.indexOf("@");
  if (at <= 1) return "••••@••••";
  return email[0] + "•".repeat(at - 1) + email.slice(at);
};

export const localizeWindowLabel = (
  raw: string | undefined,
  t: Translate,
): string => {
  if (raw?.trim().toLowerCase() === "weekly") {
    return t("ProviderWeeklyLabel");
  }
  return raw ?? "";
};

export const formatReserveDescription = (
  snap: RateWindowSnapshot,
  t: Translate,
): string | null => {
  if (snap.reservePercent == null) return null;
  if (snap.reserveWillLastToReset) return t("PanelReserveLastsUntilReset");
  if (snap.reserveEtaSeconds == null) return null;

  const hours = Math.floor(snap.reserveEtaSeconds / 3600);
  if (hours < 24) {
    return t("PanelReserveRunsOutInHours").replace("{}", String(hours));
  }
  return t("PanelReserveRunsOutInDaysHours")
    .replace("{}", String(Math.floor(hours / 24)))
    .replace("{}", String(hours % 24));
};

export const formatCompactCount = (value: number | null): string => {
  if (value == null || value <= 0) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
};

/** Format a real future subscription expiry as a compact whole-minute countdown. */
export const subscriptionCountdown = (
  endsAt: string | null,
  now: Date,
): string | null => {
  if (!endsAt || Number.isNaN(now.getTime())) return null;

  const expiryMs = Date.parse(endsAt);
  if (Number.isNaN(expiryMs) || expiryMs <= now.getTime()) return null;

  const totalMinutes = Math.ceil((expiryMs - now.getTime()) / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalMinutes < 24 * 60) {
    return `${totalHours}h ${totalMinutes % 60}m`;
  }

  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays}d ${totalHours % 24}h`;
};

export const paceStageKey = (stage: PaceSnapshot["stage"]): LocaleKey => {
  const keys: Record<PaceSnapshot["stage"], LocaleKey> = {
    on_track: "DetailPaceOnTrack",
    slightly_ahead: "DetailPaceSlightlyAhead",
    ahead: "DetailPaceAhead",
    far_ahead: "DetailPaceFarAhead",
    slightly_behind: "DetailPaceSlightlyBehind",
    behind: "DetailPaceBehind",
    far_behind: "DetailPaceFarBehind",
  };
  return keys[stage];
};

export const levelOf = (
  remainingPercent: number,
  exhausted: boolean,
): UsageLevel => {
  if (exhausted) return "exhausted";
  if (remainingPercent <= 5) return "critical";
  if (remainingPercent <= 25) return "high";
  return "normal";
};

export const getMetricPaceView = (
  snap: RateWindowSnapshot,
): MetricPaceView => {
  if (snap.isExhausted) return { kind: "none" };

  const isWeeklyWindow =
    snap.windowMinutes != null && snap.windowMinutes >= WEEKLY_WINDOW_MINUTES;
  const budget = isWeeklyWindow ? getPaceBudget(snap) : null;
  if (budget) return { kind: "budget", budget };
  if (snap.reservePercent != null) {
    return { kind: "reserve", percent: snap.reservePercent };
  }
  return { kind: "none" };
};

export const buildMetricEntries = (
  provider: ProviderUsageSnapshot,
  t: Translate,
): MetricEntry[] => {
  if (provider.accountOnly) return [];

  const metrics: MetricEntry[] =
    provider.providerId === "wayfinder"
      ? []
      : [
          {
            id: "primary",
            label: provider.primaryLabel ?? t("DetailWindowPrimary"),
            snap: provider.primary,
          },
        ];

  if (provider.secondary) {
    metrics.push({
      id: "secondary",
      label:
        localizeWindowLabel(provider.secondaryLabel, t) ||
        t("DetailWindowSecondary"),
      snap: provider.secondary,
    });
  }
  if (provider.modelSpecific) {
    metrics.push({
      id: "model-specific",
      label: t("DetailWindowModelSpecific"),
      snap: provider.modelSpecific,
    });
  }
  if (provider.tertiary) {
    metrics.push({
      id: "tertiary",
      label: t("DetailWindowTertiary"),
      snap: provider.tertiary,
    });
  }
  for (const extra of provider.extraRateWindows ?? []) {
    metrics.push({
      id: `extra-${extra.id}`,
      label: extra.title,
      snap: extra.window,
    });
  }
  return metrics;
};

export const buildPaceEntries = (
  provider: ProviderUsageSnapshot,
  t: Translate,
): PaceEntry[] => {
  const entries: PaceEntry[] = [];

  if (provider.pace) {
    entries.push({
      id: "primary",
      label:
        provider.primary.windowMinutes === 5 * 60
          ? t("PanelFiveHours")
          : provider.primaryLabel ?? t("DetailWindowPrimary"),
      pace: provider.pace,
      snap: provider.primary,
      defaultWindowMinutes: 5 * 60,
    });
  }

  if (provider.weeklyPace) {
    entries.push({
      id: "weekly",
      label:
        localizeWindowLabel(provider.secondaryLabel, t) ||
        t("ProviderWeeklyLabel"),
      pace: provider.weeklyPace,
      snap: provider.secondary,
      defaultWindowMinutes: WEEKLY_WINDOW_MINUTES,
    });
  }

  return entries;
};

/** Replace `{}` placeholders in order, matching the Rust `format_template`. */
export const fillTemplate = (template: string, ...args: string[]): string =>
  args.reduce((text, arg) => text.replace("{}", arg), template);

const PACE_TONES: Record<PaceVerdict, PaceTone> = {
  unused: "idle",
  comfortable: "steady",
  on_time: "steady",
  slightly_fast: "racing",
  too_fast: "burning",
  exhausted: "burning",
};

const formatPercentAmount = (percent: number): string =>
  `${Math.max(1, Math.round(percent))}%`;

/**
 * Turn a live pace into the per-hour rate pair and a plain-language
 * sentence telling the user whether the quota will last until reset.
 */
export const describeLivePace = (live: LivePace, t: Translate): PaceAdvice => {
  const perHour = (rate: number) =>
    fillTemplate(t("DetailPaceRatePerHour"), formatRateNumber(rate));
  const perMinute = (rate: number) =>
    fillTemplate(t("DetailPaceRatePerMinute"), formatRateNumber(rate / 60));
  const safeRate = perHour(live.safeRatePerHour);
  const untilReset = formatPaceDuration(live.secondsUntilReset);
  const early =
    live.etaSeconds != null
      ? formatPaceDuration(live.secondsUntilReset - live.etaSeconds)
      : untilReset;

  let lead: string;
  let message: string;
  switch (live.verdict) {
    case "unused":
      lead = t("DetailPaceLeadUnused");
      message = fillTemplate(t("DetailPaceMsgUnused"), untilReset);
      break;
    case "comfortable":
      lead = t("DetailPaceLeadComfortable");
      message = fillTemplate(
        t("DetailPaceMsgComfortable"),
        formatPercentAmount(live.projectedLeftoverPercent),
        safeRate,
      );
      break;
    case "on_time":
      lead = t("DetailPaceLeadOnTime");
      message = fillTemplate(
        t("DetailPaceMsgOnTime"),
        formatPercentAmount(live.projectedLeftoverPercent),
      );
      break;
    case "slightly_fast":
      lead = t("DetailPaceLeadSlightlyFast");
      message = fillTemplate(t("DetailPaceMsgSlightlyFast"), early, safeRate);
      break;
    case "too_fast":
      lead = t("DetailPaceLeadTooFast");
      message = fillTemplate(t("DetailPaceMsgTooFast"), early, safeRate);
      break;
    case "exhausted":
      lead = t("DetailPaceLeadExhausted");
      message = fillTemplate(t("DetailPaceMsgExhausted"), untilReset);
      break;
  }

  return {
    verdict: live.verdict,
    tone: PACE_TONES[live.verdict],
    lead,
    message,
    rateText: perHour(live.ratePerHour),
    safeRateText: safeRate,
    rateHint: fillTemplate(
      t("DetailPaceYourRateHint"),
      perMinute(live.ratePerHour),
    ),
    safeRateHint: fillTemplate(
      t("DetailPaceSafeRateHint"),
      perMinute(live.safeRatePerHour),
    ),
  };
};
