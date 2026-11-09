import type { PaceSnapshot, RateWindowSnapshot } from "../types/bridge";

export type PaceStage = PaceSnapshot["stage"];

/**
 * Plain-language outcome of the current pace, used for the coaching sentence.
 *
 * - `unused`: nothing used yet in this window.
 * - `comfortable`: lasts until reset with more than 10% left over.
 * - `on_time`: lasts until reset with 10% or less left over.
 * - `slightly_fast`: runs out before reset, overshooting by 5% or less.
 * - `too_fast`: runs out before reset, overshooting by more than 5%.
 * - `exhausted`: nothing left in this window.
 */
export type PaceVerdict =
  | "unused"
  | "comfortable"
  | "on_time"
  | "slightly_fast"
  | "too_fast"
  | "exhausted";

export interface LivePace {
  stage: PaceStage;
  /** Actual minus expected used percent (positive = using faster than time). */
  deltaPercent: number;
  expectedUsedPercent: number;
  actualUsedPercent: number;
  remainingPercent: number;
  /** Average consumption since the window opened, in percent per hour. */
  ratePerHour: number;
  /** Fastest steady rate that keeps the remaining quota until reset. */
  safeRatePerHour: number;
  /** Steady rate that spends exactly 100% across the whole window. */
  evenRatePerHour: number;
  secondsUntilReset: number;
  /** Seconds until the quota is exhausted at the current average rate. */
  etaSeconds: number | null;
  willLastToReset: boolean;
  /** Percent left at reset if the current rate holds (negative = shortfall). */
  projectedLeftoverPercent: number;
  verdict: PaceVerdict;
}

const HOUR_MS = 60 * 60 * 1000;

/** Overshoot (percentage points past 100%) still treated as "slightly fast". */
export const PACE_SLIGHT_OVERSHOOT_PERCENT = 5;
/** Leftover at reset (percentage points) still treated as "right on time". */
export const PACE_ON_TIME_LEFTOVER_PERCENT = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Mirrors `UsagePace::stage_for_delta` in `rust/src/core/usage_pace.rs`. */
export function paceStageForDelta(delta: number): PaceStage {
  const abs = Math.abs(delta);
  if (abs <= 2) return "on_track";
  if (abs <= 6) return delta >= 0 ? "slightly_ahead" : "slightly_behind";
  if (abs <= 12) return delta >= 0 ? "ahead" : "behind";
  return delta >= 0 ? "far_ahead" : "far_behind";
}

/**
 * Recompute pace for a rate window at `now`, so the card stays current
 * between provider refreshes. Returns null when the window has no usable
 * timing (no reset, reset in the past, or reset beyond the window length),
 * matching the Rust `UsagePace::for_window` guards.
 */
export function computeLivePace(
  snap: RateWindowSnapshot,
  now: Date,
  defaultWindowMinutes: number,
): LivePace | null {
  const nowMs = now.getTime();
  if (!snap.resetsAt || !Number.isFinite(nowMs)) return null;
  if (!Number.isFinite(snap.usedPercent)) return null;

  const minutes = snap.windowMinutes ?? defaultWindowMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  const resetMs = Date.parse(snap.resetsAt);
  if (!Number.isFinite(resetMs)) return null;

  const durationMs = minutes * 60 * 1000;
  const untilResetMs = resetMs - nowMs;
  if (untilResetMs <= 0 || untilResetMs > durationMs) return null;

  const elapsedMs = durationMs - untilResetMs;
  const used = clamp(snap.usedPercent, 0, 100);
  if (elapsedMs <= 0 && used > 0) return null;

  const remaining = 100 - used;
  const expected = clamp((elapsedMs / durationMs) * 100, 0, 100);
  const delta = used - expected;
  const elapsedHours = elapsedMs / HOUR_MS;
  const hoursLeft = untilResetMs / HOUR_MS;

  const ratePerHour = elapsedHours > 0 ? used / elapsedHours : 0;
  const safeRatePerHour = remaining / hoursLeft;
  const evenRatePerHour = 100 / (durationMs / HOUR_MS);

  let etaSeconds: number | null = null;
  let willLastToReset = true;
  if (ratePerHour > 0) {
    const etaHours = remaining / ratePerHour;
    if (etaHours < hoursLeft) {
      etaSeconds = etaHours * 3600;
      willLastToReset = false;
    }
  }

  const projectedLeftoverPercent = remaining - ratePerHour * hoursLeft;

  let verdict: PaceVerdict;
  if (snap.isExhausted || remaining <= 0) {
    verdict = "exhausted";
  } else if (used <= 0) {
    verdict = "unused";
  } else if (!willLastToReset) {
    verdict =
      -projectedLeftoverPercent <= PACE_SLIGHT_OVERSHOOT_PERCENT
        ? "slightly_fast"
        : "too_fast";
  } else if (projectedLeftoverPercent <= PACE_ON_TIME_LEFTOVER_PERCENT) {
    verdict = "on_time";
  } else {
    verdict = "comfortable";
  }

  return {
    stage: paceStageForDelta(delta),
    deltaPercent: delta,
    expectedUsedPercent: expected,
    actualUsedPercent: used,
    remainingPercent: remaining,
    ratePerHour,
    safeRatePerHour,
    evenRatePerHour,
    secondsUntilReset: untilResetMs / 1000,
    etaSeconds,
    willLastToReset,
    projectedLeftoverPercent,
    verdict,
  };
}

/** Format a percent-per-time rate with precision that keeps small rates legible. */
export function formatRateNumber(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "0";
  if (rate < 0.095) return rate.toFixed(3);
  if (rate < 0.995) return rate.toFixed(2);
  if (rate < 9.95) return rate.toFixed(1);
  return rate.toFixed(0);
}

/**
 * Compact, non-rounding-up duration: "45m", "3h 30m", "14h", "2d 20h".
 * Unlike the coarse ETA formatter, it never turns 2d 20h into "3d".
 */
export function formatPaceDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 10) {
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  }
  if (totalHours < 24) return `${totalHours}h`;

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}
