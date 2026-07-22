import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SettingsSnapshot } from "../types/bridge";
import FloatBarSettingsSection from "./SettingsSection";

vi.mock("../hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

const settings = {
  floatBarEnabled: true,
  floatBarOpacity: 90,
  floatBarScale: 100,
  floatBarOrientation: "horizontal",
  floatBarStyle: "floating",
  floatBarShowCost: false,
  floatBarShowAccount: true,
  floatBarShowResetInline: false,
  floatBarDarkText: false,
  floatBarClickThrough: false,
} as unknown as SettingsSnapshot;

describe("FloatBar settings", () => {
  it("keeps the deprecated cost toggle out of the restored UI", () => {
    render(
      <FloatBarSettingsSection settings={settings} saving={false} set={vi.fn()} />,
    );

    expect(screen.queryByText("FloatBarShowCost")).not.toBeInTheDocument();
  });

  it("persists the account-pill toggle from the Display tab", () => {
    const set = vi.fn();
    render(
      <FloatBarSettingsSection settings={settings} saving={false} set={set} />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "FloatBarShowAccount" }),
    );
    expect(set).toHaveBeenCalledWith({ floatBarShowAccount: false });
    expect(screen.getByText("FloatBarShowAccountDescription")).toBeInTheDocument();
  });
});
