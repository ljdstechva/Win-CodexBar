import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../../../i18n/LocaleProvider";
import { buildBundle } from "../../../../test/localeHarness";
import type { ProviderDetail } from "../../../../types/bridge";
import { UsageSection } from "./UsageSection";

const tauriMocks = vi.hoisted(() => ({
  getLocaleStrings: vi.fn(),
  setUiLanguage: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("../../../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/tauri")>()),
  ...tauriMocks,
}));
vi.mock("@tauri-apps/api/event", () => eventMocks);

function rateWindow(usedPercent: number) {
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowMinutes: null,
    resetsAt: null,
    resetDescription: null,
    isExhausted: false,
    reservePercent: null,
    reserveDescription: null,
  };
}

function provider(): ProviderDetail {
  return {
    id: "copilot",
    displayName: "GitHub Copilot",
    enabled: true,
    email: null,
    plan: null,
    authType: null,
    sourceLabel: null,
    organization: null,
    lastUpdated: null,
    session: rateWindow(20),
    weekly: null,
    modelSpecific: null,
    tertiary: null,
    extraRateWindows: [
      { id: "additional_budget", title: "Additional Budget", window: rateWindow(42) },
    ],
    cost: null,
    pace: null,
    lastError: null,
    dashboardUrl: null,
    statusPageUrl: null,
    buyCreditsUrl: null,
    hasSnapshot: true,
    cookieSource: null,
    region: null,
  };
}

describe("UsageSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.getLocaleStrings.mockResolvedValue(buildBundle());
    eventMocks.listen.mockResolvedValue(() => {});
  });

  it("renders extra Copilot budget windows as remaining capacity", async () => {
    const { container } = render(
      <LocaleProvider>
        <UsageSection
          provider={provider()}
          resetTimeRelative={true}
          showAsUsed={false}
          t={(key) => key}
        />
      </LocaleProvider>,
    );

    expect(await screen.findByText("Additional Budget")).toBeInTheDocument();
    expect(screen.getByText("80% PanelLeftSuffix")).toBeInTheDocument();
    expect(screen.getByText("58% PanelLeftSuffix")).toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll<HTMLElement>(".provider-usage-bar__fill"))
        .map((element) => element.style.width),
    ).toEqual(["80%", "58%"]);
  });

  it("retains consumed-capacity rendering when explicitly requested", async () => {
    render(
      <LocaleProvider>
        <UsageSection
          provider={provider()}
          resetTimeRelative={true}
          showAsUsed
          t={(key) => key}
        />
      </LocaleProvider>,
    );

    expect(await screen.findByText("20% PanelUsedSuffix")).toBeInTheDocument();
    expect(screen.getByText("42% PanelUsedSuffix")).toBeInTheDocument();
  });
});
