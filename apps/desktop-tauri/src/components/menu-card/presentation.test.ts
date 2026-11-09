import { describe, expect, it } from "vitest";
import type { ProviderUsageSnapshot, RateWindowSnapshot } from "../../types/bridge";
import {
  buildMetricEntries,
  buildPaceEntries,
  describeLivePace,
  displayPlanName,
  fillTemplate,
  formatCompactCount,
  formatReserveDescription,
  getMetricPaceView,
  levelOf,
  maskEmail,
  subscriptionCountdown,
  type Translate,
} from "./presentation";

const t = ((key: string) => key) as Translate;

const windowSnapshot = (
  overrides: Partial<RateWindowSnapshot> = {},
): RateWindowSnapshot => ({
  usedPercent: 20,
  remainingPercent: 80,
  windowMinutes: null,
  resetsAt: null,
  resetDescription: null,
  isExhausted: false,
  reservePercent: null,
  reserveDescription: null,
  ...overrides,
});

const provider = (): ProviderUsageSnapshot => ({
  providerId: "codex",
  displayName: "Codex",
  primary: windowSnapshot(),
  primaryLabel: "Session",
  secondary: windowSnapshot(),
  secondaryLabel: "Weekly",
  modelSpecific: null,
  tertiary: null,
  extraRateWindows: [
    { id: "credits", title: "Credits", window: windowSnapshot() },
  ],
  cost: null,
  planName: null,
  subscriptionEndsAt: null,
  accountEmail: null,
  sourceLabel: "oauth",
  updatedAt: "2026-07-11T00:00:00Z",
  error: null,
  pace: null,
  weeklyPace: null,
  accountOrganization: null,
  trayStatusLabel: null,
});

describe("usage-card presentation", () => {
  it("keeps masking, plan normalization, and compact counts deterministic", () => {
    expect(maskEmail("alice@example.com")).toBe("a••••@example.com");
    expect(displayPlanName("DEFAULT_CLAUDE_AI")).toBe("Claude AI");
    expect(formatCompactCount(29_300_000_000)).toBe("29.3B");
    expect(formatCompactCount(null)).toBe("—");
  });

  it("derives stable metric entries and localizes the weekly label", () => {
    const metrics = buildMetricEntries(provider(), t);
    expect(metrics.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "primary", label: "Session" },
      { id: "secondary", label: "ProviderWeeklyLabel" },
      { id: "extra-credits", label: "Credits" },
    ]);
  });

  it("does not invent a quota row for Wayfinder telemetry", () => {
    const snapshot = provider();
    snapshot.providerId = "wayfinder";
    snapshot.secondary = null;
    snapshot.extraRateWindows = [];

    expect(buildMetricEntries(snapshot, t)).toEqual([]);
  });

  it("does not invent a quota row for an account-only provider", () => {
    const snapshot = provider();
    snapshot.providerId = "chatgpt";
    snapshot.accountOnly = true;

    expect(buildMetricEntries(snapshot, t)).toEqual([]);
  });

  it("derives separately labeled primary and weekly pace entries", () => {
    const snapshot = provider();
    snapshot.primary = windowSnapshot({ windowMinutes: 5 * 60 });
    snapshot.pace = {
      stage: "on_track",
      deltaPercent: 1,
      willLastToReset: true,
      etaSeconds: null,
      expectedUsedPercent: 19,
      actualUsedPercent: 20,
    };
    snapshot.weeklyPace = {
      stage: "behind",
      deltaPercent: -10,
      willLastToReset: true,
      etaSeconds: null,
      expectedUsedPercent: 30,
      actualUsedPercent: 20,
    };

    expect(
      buildPaceEntries(snapshot, t).map(({ id, label }) => ({ id, label })),
    ).toEqual([
      { id: "primary", label: "PanelFiveHours" },
      { id: "weekly", label: "ProviderWeeklyLabel" },
    ]);
  });

  it("classifies remaining usage and reserve descriptions", () => {
    expect(levelOf(80, false)).toBe("normal");
    expect(levelOf(20, false)).toBe("high");
    expect(levelOf(4, false)).toBe("critical");
    expect(levelOf(80, true)).toBe("exhausted");
    expect(
      formatReserveDescription(
        windowSnapshot({ reservePercent: 10, reserveEtaSeconds: 90_000 }),
        t,
      ),
    ).toBe("PanelReserveRunsOutInDaysHours");
  });

  it("keeps short windows out of the weekly pace-budget model", () => {
    const view = getMetricPaceView(
      windowSnapshot({
        windowMinutes: 300,
        reservePercent: 12,
      }),
    );
    expect(view).toEqual({ kind: "reserve", percent: 12 });
  });

  it("formats future subscription countdown boundaries", () => {
    const now = new Date("2026-07-20T10:00:00Z");

    expect(subscriptionCountdown(null, now)).toBeNull();
    expect(subscriptionCountdown("2026-07-20T09:59:59Z", now)).toBeNull();
    expect(subscriptionCountdown("2026-07-20T10:25:00Z", now)).toBe("25m");
    expect(subscriptionCountdown("2026-07-21T03:25:00Z", now)).toBe(
      "17h 25m",
    );
    expect(subscriptionCountdown("2026-07-23T14:00:00Z", now)).toBe(
      "3d 4h",
    );
    expect(subscriptionCountdown("not-a-date", now)).toBeNull();
  });

  it("rounds a positive sub-minute subscription duration up to one minute", () => {
    const now = new Date("2026-07-20T10:00:00Z");
    expect(subscriptionCountdown("2026-07-20T10:00:01Z", now)).toBe("1m");
  });

  it("keeps the rate window and default duration on each pace entry", () => {
    const snapshot = provider();
    snapshot.primary = windowSnapshot({ windowMinutes: 5 * 60 });
    snapshot.secondary = windowSnapshot({ windowMinutes: 7 * 24 * 60 });
    const pace = {
      stage: "on_track" as const,
      deltaPercent: 0,
      willLastToReset: true,
      etaSeconds: null,
      expectedUsedPercent: 20,
      actualUsedPercent: 20,
    };
    snapshot.pace = pace;
    snapshot.weeklyPace = pace;

    const [primary, weekly] = buildPaceEntries(snapshot, t);
    expect(primary.snap).toBe(snapshot.primary);
    expect(primary.defaultWindowMinutes).toBe(300);
    expect(weekly.snap).toBe(snapshot.secondary);
    expect(weekly.defaultWindowMinutes).toBe(10_080);
  });

  it("fills placeholders in order", () => {
    expect(fillTemplate("{} then {}", "a", "b")).toBe("a then b");
    expect(fillTemplate("{}%/h", "0.60")).toBe("0.60%/h");
  });
});

describe("describeLivePace", () => {
  const english: Partial<Record<string, string>> = {
    DetailPaceRatePerHour: "{}%/h",
    DetailPaceRatePerMinute: "{}%/min",
    DetailPaceYourRateHint: "Average per hour ({})",
    DetailPaceSafeRateHint: "Fastest safe pace ({})",
    DetailPaceLeadSlightlyFast: "A little too fast.",
    DetailPaceMsgSlightlyFast:
      "At this rate you'd run out about {} before the reset. Easing off to {} keeps you covered.",
    DetailPaceLeadComfortable: "Well within budget.",
    DetailPaceMsgComfortable:
      "At this rate you'll still have about {} left when it resets. You can speed up to {} and still make it.",
    DetailPaceLeadUnused: "Fresh window.",
    DetailPaceMsgUnused: "All of it is yours for the next {}.",
  };
  const tEn = ((key: string) => english[key] ?? key) as Translate;
  const base = {
    stage: "on_track" as const,
    deltaPercent: 0.7,
    expectedUsedPercent: 58.3,
    actualUsedPercent: 59,
    remainingPercent: 41,
    evenRatePerHour: 100 / 168,
    willLastToReset: true,
    etaSeconds: null,
  };

  it("tells the user how much earlier than the reset they would run out", () => {
    const advice = describeLivePace(
      {
        ...base,
        ratePerHour: 59 / 98,
        safeRatePerHour: 41 / 70,
        secondsUntilReset: 70 * 3600,
        etaSeconds: 68 * 3600,
        willLastToReset: false,
        projectedLeftoverPercent: -1.1,
        verdict: "slightly_fast",
      },
      tEn,
    );

    expect(advice.tone).toBe("racing");
    expect(advice.rateText).toBe("0.60%/h");
    expect(advice.safeRateText).toBe("0.59%/h");
    expect(advice.rateHint).toBe("Average per hour (0.010%/min)");
    expect(advice.lead).toBe("A little too fast.");
    expect(advice.message).toBe(
      "At this rate you'd run out about 2h before the reset. Easing off to 0.59%/h keeps you covered.",
    );
  });

  it("reassures the user when the quota comfortably lasts", () => {
    const advice = describeLivePace(
      {
        ...base,
        ratePerHour: 0.24,
        safeRatePerHour: 0.95,
        secondsUntilReset: 84 * 3600,
        projectedLeftoverPercent: 59.8,
        verdict: "comfortable",
      },
      tEn,
    );

    expect(advice.tone).toBe("steady");
    expect(advice.message).toBe(
      "At this rate you'll still have about 60% left when it resets. You can speed up to 0.95%/h and still make it.",
    );
  });

  it("describes an untouched window with the time until reset", () => {
    const advice = describeLivePace(
      {
        ...base,
        actualUsedPercent: 0,
        ratePerHour: 0,
        safeRatePerHour: 1,
        secondsUntilReset: 100 * 3600,
        projectedLeftoverPercent: 100,
        verdict: "unused",
      },
      tEn,
    );

    expect(advice.tone).toBe("idle");
    expect(advice.rateText).toBe("0%/h");
    expect(advice.message).toBe("All of it is yours for the next 4d 4h.");
  });
});
