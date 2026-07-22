import { describe, expect, it } from "vitest";
import {
  TRAY_SCALE_MAX,
  TRAY_SCALE_MIN,
  clampTrayScalePercent,
} from "./useTrayScale";

describe("tray scale boundaries", () => {
  it("clamps invalid and out-of-range persisted values", () => {
    expect(clampTrayScalePercent(Number.NaN)).toBe(100);
    expect(clampTrayScalePercent(50)).toBe(TRAY_SCALE_MIN);
    expect(clampTrayScalePercent(80)).toBe(80);
    expect(clampTrayScalePercent(150)).toBe(150);
    expect(clampTrayScalePercent(250)).toBe(TRAY_SCALE_MAX);
  });
});
