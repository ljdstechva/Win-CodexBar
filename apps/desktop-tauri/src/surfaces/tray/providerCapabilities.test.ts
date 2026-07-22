import { describe, expect, it } from "vitest";
import {
  hasProviderDashboard,
  hasProviderStatusPage,
} from "./providerCapabilities";

describe("tray provider capabilities", () => {
  it("keeps known dashboard and status-page capabilities explicit", () => {
    expect(hasProviderDashboard("codex")).toBe(true);
    expect(hasProviderStatusPage("codex")).toBe(true);
    expect(hasProviderDashboard("factory")).toBe(true);
    expect(hasProviderStatusPage("factory")).toBe(false);
    expect(hasProviderDashboard("unknown-provider")).toBe(false);
    expect(hasProviderStatusPage("unknown-provider")).toBe(false);
  });
});
