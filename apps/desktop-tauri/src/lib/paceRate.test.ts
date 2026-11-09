import { describe, expect, it } from "vitest";
import type { RateWindowSnapshot } from "../types/bridge";
import {
  computeLivePace,
  formatPaceDuration,
  formatRateNumber,
  paceStageForDelta,
} from "./paceRate";

const HOUR = 60 * 60 * 1000;
const WEEK_MINUTES = 7 * 24 * 60;
const NOW = new Date("2026-11-09T10:00:00Z");

const weekly = (
  usedPercent: number,
  hoursUntilReset: number,
  overrides: Partial<RateWindowSnapshot> = {},
): RateWindowSnapshot => ({
  usedPercent,
  remainingPercent: 100 - usedPercent,
  windowMinutes: WEEK_MINUTES,
  resetsAt: new Date(NOW.getTime() + hoursUntilReset * HOUR).toISOString(),
  resetDescription: null,
  isExhausted: false,
  reservePercent: null,
  reserveDescription: null,
  ...overrides,
});

describe("computeLivePace", () => {
  it("explains an on-track week that still runs out shortly before reset", () => {
    // 59% used with 2d 22h left: +1.2% ahead, but the average rate
    // empties the quota a couple of hours before the reset.
    const live = computeLivePace(weekly(59, 70), NOW, WEEK_MINUTES);

    expect(live).not.toBeNull();
    expect(live!.stage).toBe("on_track");
    expect(live!.deltaPercent).toBeCloseTo(0.67, 1);
    expect(live!.ratePerHour).toBeCloseTo(59 / 98, 4);
    expect(live!.safeRatePerHour).toBeCloseTo(41 / 70, 4);
    expect(live!.evenRatePerHour).toBeCloseTo(100 / 168, 4);
    expect(live!.willLastToReset).toBe(false);
    expect(live!.etaSeconds! / 3600).toBeCloseTo(41 / (59 / 98), 3);
    expect(live!.verdict).toBe("slightly_fast");
  });

  it("marks a heavy overshoot as too fast", () => {
    const live = computeLivePace(weekly(80, 84), NOW, WEEK_MINUTES);
    expect(live!.stage).toBe("far_ahead");
    expect(live!.willLastToReset).toBe(false);
    expect(live!.verdict).toBe("too_fast");
  });

  it("treats a small leftover as right on time", () => {
    // 3.5 days in, 46% used: lasts with ~8% left.
    const live = computeLivePace(weekly(46, 84), NOW, WEEK_MINUTES);
    expect(live!.willLastToReset).toBe(true);
    expect(live!.projectedLeftoverPercent).toBeCloseTo(8, 5);
    expect(live!.verdict).toBe("on_time");
  });

  it("reports a comfortable margin and a higher safe rate when well under pace", () => {
    const live = computeLivePace(weekly(20, 84), NOW, WEEK_MINUTES);
    expect(live!.stage).toBe("far_behind");
    expect(live!.verdict).toBe("comfortable");
    expect(live!.projectedLeftoverPercent).toBeCloseTo(60, 5);
    expect(live!.safeRatePerHour).toBeGreaterThan(live!.ratePerHour);
  });

  it("handles unused and exhausted windows", () => {
    expect(computeLivePace(weekly(0, 100), NOW, WEEK_MINUTES)!.verdict).toBe(
      "unused",
    );
    expect(
      computeLivePace(weekly(100, 10, { isExhausted: true }), NOW, WEEK_MINUTES)!
        .verdict,
    ).toBe("exhausted");
  });

  it("advances the expected percent as time passes without a refresh", () => {
    const snap = weekly(50, 84);
    const first = computeLivePace(snap, NOW, WEEK_MINUTES)!;
    const later = computeLivePace(
      snap,
      new Date(NOW.getTime() + 60 * 60 * 1000),
      WEEK_MINUTES,
    )!;
    expect(later.expectedUsedPercent).toBeGreaterThan(first.expectedUsedPercent);
    expect(later.deltaPercent).toBeLessThan(first.deltaPercent);
    expect(later.ratePerHour).toBeLessThan(first.ratePerHour);
  });

  it("uses the default duration when the snapshot omits it", () => {
    const snap = weekly(10, 2, { windowMinutes: null });
    const live = computeLivePace(snap, NOW, 300)!;
    expect(live.expectedUsedPercent).toBeCloseTo(60, 5);
  });

  it("returns null without usable timing", () => {
    expect(
      computeLivePace(weekly(10, 10, { resetsAt: null }), NOW, WEEK_MINUTES),
    ).toBeNull();
    expect(computeLivePace(weekly(10, -1), NOW, WEEK_MINUTES)).toBeNull();
    expect(computeLivePace(weekly(10, 200), NOW, WEEK_MINUTES)).toBeNull();
    expect(
      computeLivePace(weekly(10, 10, { resetsAt: "not a date" }), NOW, WEEK_MINUTES),
    ).toBeNull();
  });
});

describe("paceStageForDelta", () => {
  it("mirrors the Rust thresholds", () => {
    expect(paceStageForDelta(2)).toBe("on_track");
    expect(paceStageForDelta(-2)).toBe("on_track");
    expect(paceStageForDelta(4)).toBe("slightly_ahead");
    expect(paceStageForDelta(-4)).toBe("slightly_behind");
    expect(paceStageForDelta(10)).toBe("ahead");
    expect(paceStageForDelta(-10)).toBe("behind");
    expect(paceStageForDelta(20)).toBe("far_ahead");
    expect(paceStageForDelta(-20)).toBe("far_behind");
  });
});

describe("formatters", () => {
  it("keeps small rates legible", () => {
    expect(formatRateNumber(0)).toBe("0");
    expect(formatRateNumber(0.0098)).toBe("0.010");
    expect(formatRateNumber(0.602)).toBe("0.60");
    expect(formatRateNumber(4.26)).toBe("4.3");
    expect(formatRateNumber(18.4)).toBe("18");
  });

  it("never rounds a duration up into the next unit", () => {
    expect(formatPaceDuration(45 * 60)).toBe("45m");
    expect(formatPaceDuration(90 * 60)).toBe("1h 30m");
    expect(formatPaceDuration(2 * 3600)).toBe("2h");
    expect(formatPaceDuration(14.6 * 3600)).toBe("14h");
    expect(formatPaceDuration(68 * 3600)).toBe("2d 20h");
    expect(formatPaceDuration(48 * 3600)).toBe("2d");
  });
});
