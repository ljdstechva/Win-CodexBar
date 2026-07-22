import { describe, expect, it } from "vitest";
import type { RateWindowSnapshot } from "../types/bridge";
import {
  displayUsageBarPercent,
  displayUsagePercent,
  formatPaceEta,
} from "./usageDisplay";

function rate(usedPercent: number, remainingPercent = 100 - usedPercent) {
  return { usedPercent, remainingPercent } as RateWindowSnapshot;
}

describe("usage display semantics", () => {
  it("shows the provider remaining value in percent-left mode", () => {
    expect(displayUsagePercent(rate(35, 65), false)).toBe(65);
  });

  it("preserves consumed values in percent-used mode", () => {
    expect(displayUsagePercent(rate(35, 65), true)).toBe(35);
  });

  it("clamps exhausted remaining values to zero", () => {
    expect(displayUsagePercent(rate(105, -5), false)).toBe(0);
  });

  it("allows overage labels but caps bar width", () => {
    expect(displayUsagePercent(rate(105, 0), true)).toBe(105);
    expect(displayUsageBarPercent(rate(105, 0), true)).toBe(100);
  });

  it("formats pace depletion estimates at a useful precision", () => {
    expect(formatPaceEta(29 * 60)).toBe("29m");
    expect(formatPaceEta(3.5 * 60 * 60)).toBe("4h");
    expect(formatPaceEta(49 * 60 * 60)).toBe("2d");
  });
});
