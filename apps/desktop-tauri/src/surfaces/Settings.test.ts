import { describe, expect, it } from "vitest";
import { TAB_META } from "./Settings";

describe("Settings navigation", () => {
  it("restores the accepted five-tab settings shell", () => {
    expect(TAB_META).toEqual([
      { id: "general", labelKey: "TabGeneral" },
      { id: "providers", labelKey: "TabProviders" },
      { id: "display", labelKey: "TabDisplay" },
      { id: "advanced", labelKey: "TabAdvanced" },
      { id: "about", labelKey: "TabAbout" },
    ]);
  });
});
