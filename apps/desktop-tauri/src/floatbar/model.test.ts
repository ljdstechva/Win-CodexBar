import { describe, expect, it } from "vitest";
import type {
  ProviderUsageSnapshot,
  RateWindowSnapshot,
} from "../types/bridge";
import {
  accountSummary,
  classifyFloatBarWindows,
  fableOnlyWindow,
  FLOAT_BAR_NO_VALUE,
  hasVisibleAccountSummary,
  providerKey,
  remainingTone,
  selectVisibleProviders,
} from "./model";

function rateWindow(
  usedPercent: number,
  windowMinutes: number | null,
): RateWindowSnapshot {
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowMinutes,
    resetsAt: null,
    resetDescription: null,
    isExhausted: false,
    reservePercent: null,
    reserveDescription: null,
  };
}

function provider(
  providerId: string,
  usedPercent: number,
  primaryMinutes = 5 * 60,
): ProviderUsageSnapshot {
  return {
    providerId,
    displayName: providerId,
    primary: rateWindow(usedPercent, primaryMinutes),
    accountOnly: false,
    secondary: null,
    modelSpecific: null,
    tertiary: null,
    extraRateWindows: [],
    cost: null,
    planName: null,
    subscriptionEndsAt: null,
    accountEmail: null,
    sourceLabel: "test",
    updatedAt: "2026-05-15T00:00:00Z",
    error: null,
    pace: null,
    weeklyPace: null,
    accountOrganization: null,
    trayStatusLabel: null,
  };
}

describe("FloatBar model", () => {
  it("uses the exact remaining-quota thresholds", () => {
    expect(remainingTone(50)).toBe("green");
    expect(remainingTone(49.9)).toBe("yellow");
    expect(remainingTone(30)).toBe("yellow");
    expect(remainingTone(29.9)).toBe("orange");
    expect(remainingTone(10)).toBe("orange");
    expect(remainingTone(9.9)).toBe("red");
    expect(remainingTone(85, true)).toBe("red");
  });

  it("classifies a weekly primary window without relabeling it as 5h", () => {
    const weeklyPrimary = provider("codex", 25, 7 * 24 * 60);
    weeklyPrimary.secondary = rateWindow(60, 5 * 60);
    weeklyPrimary.pace = {
      stage: "behind",
      deltaPercent: 4,
      willLastToReset: false,
      etaSeconds: null,
      expectedUsedPercent: 21,
      actualUsedPercent: 25,
    };
    weeklyPrimary.weeklyPace = {
      stage: "on_track",
      deltaPercent: -1,
      willLastToReset: true,
      etaSeconds: null,
      expectedUsedPercent: 26,
      actualUsedPercent: 25,
    };

    const windows = classifyFloatBarWindows(weeklyPrimary);
    expect(windows.fiveHour).toBe(weeklyPrimary.secondary);
    expect(windows.sevenDay).toBe(weeklyPrimary.primary);
  });

  it("treats informational quota placeholders as unavailable", () => {
    const claude = provider("claude", 0);
    claude.primary.isInformational = true;
    claude.secondary = rateWindow(20, 7 * 24 * 60);

    const windows = classifyFloatBarWindows(claude);
    expect(windows.fiveHour).toBeNull();
    expect(windows.sevenDay).toBe(claude.secondary);

    const informationalFable = rateWindow(0, 7 * 24 * 60);
    informationalFable.isInformational = true;
    claude.extraRateWindows = [
      {
        id: "claude-weekly-scoped-fable",
        title: "Fable only",
        window: informationalFable,
      },
    ];
    expect(fableOnlyWindow(claude)).toBeNull();
  });

  it("does not relabel unknown, daily, or monthly durations", () => {
    const unknown = provider("unknown", 10);
    unknown.primary.windowMinutes = null;
    unknown.secondary = rateWindow(20, 24 * 60);
    expect(classifyFloatBarWindows(unknown)).toEqual({
      fiveHour: null,
      sevenDay: null,
    });

    const monthly = provider("monthly", 30, 30 * 24 * 60);
    expect(classifyFloatBarWindows(monthly)).toEqual({
      fiveHour: null,
      sevenDay: null,
    });
  });

  it("selects only Claude's scoped Fable quota", () => {
    const claude = provider("claude", 20);
    const design = rateWindow(12, 7 * 24 * 60);
    const fable = rateWindow(61, 7 * 24 * 60);
    claude.extraRateWindows = [
      {
        id: "claude-weekly-scoped-design",
        title: "Design only",
        window: design,
      },
      {
        id: "claude-weekly-scoped-claude-fable-5-promo",
        title: "Fable only",
        window: fable,
      },
    ];

    expect(fableOnlyWindow(claude)).toBe(fable);

    const codex = provider("codex", 20);
    codex.extraRateWindows = claude.extraRateWindows;
    expect(fableOnlyWindow(codex)).toBeNull();
  });

  it("accepts the normalized Fable-only title as a compatibility fallback", () => {
    const claude = provider("claude", 20);
    const fable = rateWindow(7, 7 * 24 * 60);
    claude.extraRateWindows = [
      { id: "provider-scope-current", title: "Fable only", window: fable },
    ];

    expect(fableOnlyWindow(claude)).toBe(fable);
  });

  it("filters disabled and allow-listed providers, then sorts by use", () => {
    const claude = provider("claude", 20);
    const codex = provider("codex", 75);
    const gemini = provider("gemini", 50);

    expect(
      selectVisibleProviders([claude, codex, gemini], ["claude", "codex"]),
    ).toEqual([codex, claude]);
    expect(
      selectVisibleProviders(
        [claude, codex, gemini],
        ["claude", "codex", "gemini"],
        ["gemini", "claude"],
      ),
    ).toEqual([gemini, claude]);
  });

  it("includes the account in a provider key when available", () => {
    const value = provider("codex", 20);
    value.accountEmail = "dev@example.com";
    expect(providerKey(value)).toBe("codex:dev@example.com");
  });

  it("derives normalized plan and genuine expiry account data", () => {
    const value = provider("claude", 20);
    value.planName = " DEFAULT_CLAUDE_AI ";
    value.subscriptionEndsAt = "2026-07-23T00:00:00Z";

    expect(accountSummary(value, new Date("2026-07-22T00:00:00Z"))).toEqual({
      planLabel: "Claude AI",
      endsAt: "2026-07-23T00:00:00Z",
    });
  });

  it("hides absent account data and rejects an invalid expiry", () => {
    const value = provider("codex", 20);
    expect(accountSummary(value)).toBeNull();

    value.subscriptionEndsAt = "not-a-date";
    expect(accountSummary(value)).toBeNull();
  });

  it("uses an em dash when a real expiry has no plan label", () => {
    const value = provider("kimi", 20);
    value.subscriptionEndsAt = "2026-07-23T00:00:00Z";

    expect(accountSummary(value, new Date("2026-07-22T00:00:00Z"))).toEqual({
      planLabel: FLOAT_BAR_NO_VALUE,
      endsAt: "2026-07-23T00:00:00Z",
    });
  });

  it("never exposes a monetary balance as a FloatBar plan label", () => {
    const value = provider("openaiapi", 20);
    value.planName = "API balance: $75.00";
    value.subscriptionEndsAt = "2026-07-23T00:00:00Z";

    expect(accountSummary(value, new Date("2026-07-22T00:00:00Z"))).toEqual({
      planLabel: FLOAT_BAR_NO_VALUE,
      endsAt: "2026-07-23T00:00:00Z",
    });
  });

  it("never exposes email or organization identity as a plan label", () => {
    const emailValue = provider("ollama", 20);
    emailValue.planName = "dev@example.com";
    expect(accountSummary(emailValue)).toBeNull();

    const organizationValue = provider("factory", 20);
    organizationValue.planName = "Acme Environmental Consulting";
    organizationValue.accountOrganization = "Acme Environmental Consulting";
    expect(accountSummary(organizationValue)).toBeNull();
  });

  it("rejects overloaded balance, auth, and project metadata labels", () => {
    const cases = [
      ["manus", "Balance: 75 credits"],
      ["claude", "Claude (OAuth)"],
      ["llmproxy", "2 / 3 active keys"],
      ["nanogpt", "trial until 2026-08-01"],
      ["vertexai", "Vertex AI (client-project)"],
      ["deepgram", "Client transcription project"],
      ["alibabatokenplan", "Token Plan Balance: 75 credits"],
    ] as const;

    for (const [providerId, planName] of cases) {
      const value = provider(providerId, 20);
      value.planName = planName;
      expect(accountSummary(value)).toBeNull();
    }
  });

  it("keeps genuine plan labels after privacy filtering", () => {
    const cases = [
      ["codex", "ChatGPT Pro"],
      ["chatgpt", "Team"],
      ["claude", "Claude Max 5x"],
      ["alibabatokenplan", "Token Plan Team"],
    ] as const;

    for (const [providerId, planName] of cases) {
      const value = provider(providerId, 20);
      value.planName = planName;
      expect(accountSummary(value)?.planLabel).toBe(
        providerId === "chatgpt" ? "ChatGPT Team" : planName,
      );
    }
  });

  it("hides an expiry-only account after its genuine end date", () => {
    const value = provider("kimi", 20);
    value.subscriptionEndsAt = "2026-07-23T00:00:00Z";
    const summary = accountSummary(value, new Date("2026-07-22T23:59:59Z"));

    expect(summary).not.toBeNull();
    expect(
      hasVisibleAccountSummary(summary!, new Date("2026-07-22T23:59:59Z")),
    ).toBe(true);
    expect(
      hasVisibleAccountSummary(summary!, new Date("2026-07-23T00:00:00Z")),
    ).toBe(false);
  });

  it("keeps plan-only account data visible without a future expiry", () => {
    const value = provider("claude", 20);
    value.planName = "max";
    const summary = accountSummary(value);

    expect(summary).not.toBeNull();
    expect(
      hasVisibleAccountSummary(summary!, new Date("2026-07-23T00:00:00Z")),
    ).toBe(true);
  });

  it("rejects past subscription dates while preserving the truthful plan fallback", () => {
    const value = provider("claude", 20);
    value.planName = "Claude Max 5x";
    value.subscriptionEndsAt = "2026-07-21T23:59:59Z";

    expect(accountSummary(value, new Date("2026-07-22T00:00:00Z"))).toEqual({
      planLabel: "Claude Max 5x",
      endsAt: null,
    });
  });
});
