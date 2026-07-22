import { describe, expect, it } from "vitest";

import type { ProviderUsageSnapshot } from "../../../types/bridge";
import { providerSidebarMetric } from "./ProvidersTab";

const t = (key: string) => (key === "PanelUsedSuffix" ? "used" : "left");

function snapshot(accountOnly = false): ProviderUsageSnapshot {
  return {
    providerId: "chatgpt",
    displayName: "ChatGPT",
    accountOnly,
    primary: { usedPercent: 0, remainingPercent: 100 },
    secondary: null,
    modelSpecific: null,
    tertiary: null,
    extraRateWindows: [],
    cost: null,
    pace: null,
    error: null,
    sourceLabel: "web",
    updatedAt: "2026-07-22T00:00:00Z",
  } as unknown as ProviderUsageSnapshot;
}

describe("providerSidebarMetric", () => {
  it("omits the synthetic transport window for account-only providers", () => {
    expect(providerSidebarMetric(snapshot(true), false, t as never)).toBeUndefined();
  });

  it("keeps quota metrics for ordinary providers", () => {
    expect(providerSidebarMetric(snapshot(false), false, t as never)).toBe("100% left");
  });
});
