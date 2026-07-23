import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  getCachedProviders: vi.fn(),
  getProviderChartData: vi.fn(),
  refreshProviders: vi.fn(),
  refreshProvidersIfStale: vi.fn(),
  getSettingsSnapshot: vi.fn(),
  updateSettings: vi.fn(),
  getLocaleStrings: vi.fn(),
  setUiLanguage: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
}));

const windowMocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(() => ({
    startDragging: vi.fn().mockResolvedValue(undefined),
  })),
}));

const coreMocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/tauri", () => tauriMocks);
vi.mock("@tauri-apps/api/event", () => eventMocks);
vi.mock("@tauri-apps/api/window", () => windowMocks);
vi.mock("@tauri-apps/api/core", () => coreMocks);

import FloatBar from "./FloatBar";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { buildBundle } from "../test/localeHarness";
import type { BootstrapState, ProviderUsageSnapshot, SettingsSnapshot } from "../types/bridge";

function rateWindow(
  used: number,
  opts: {
    exhausted?: boolean;
    resetsAt?: string | null;
    resetDescription?: string | null;
  } = {},
) {
  return {
    usedPercent: used,
    remainingPercent: 100 - used,
    windowMinutes: 5 * 60,
    resetsAt: opts.resetsAt ?? null,
    resetDescription: opts.resetDescription ?? null,
    isExhausted: opts.exhausted ?? false,
    reservePercent: null,
    reserveDescription: null,
  };
}

function snapshot(
  id: string,
  display: string,
  used: number,
  opts: {
    exhausted?: boolean;
    error?: string | null;
    resetsAt?: string | null;
    resetDescription?: string | null;
  } = {},
): ProviderUsageSnapshot {
  return {
    providerId: id,
    displayName: display,
    primary: rateWindow(used, opts),
    accountOnly: false,
    secondary: null,
    modelSpecific: null,
    tertiary: null,
    extraRateWindows: [],
    cost: null,
    planName: null,
    subscriptionEndsAt: null,
    accountEmail: null,
    sourceLabel: "auto",
    updatedAt: "2026-05-15T00:00:00Z",
    error: opts.error ?? null,
    pace: null,
    weeklyPace: null,
    accountOrganization: null,
    trayStatusLabel: null,
  };
}

function settings(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    enabledProviders: ["claude", "codex"],
    refreshIntervalSecs: 300,
    adaptiveRefresh: false,
    refreshAllProvidersOnMenuOpen: false,
    startAtLogin: false,
    startMinimized: false,
    showNotifications: true,
    soundEnabled: true,
    soundVolume: 100,
    highUsageThreshold: 70,
    criticalUsageThreshold: 90,
    predictivePaceWarningEnabled: false,
    trayIconMode: "single",
    switcherShowsIcons: true,
    menuBarShowsHighestUsage: false,
    menuBarShowsPercent: false,
    showAsUsed: true,
    showAllTokenAccountsInMenu: false,
    enableAnimations: true,
    resetTimeRelative: true,
    showResetWhenExhausted: false,
    menuBarDisplayMode: "detailed",
    hidePersonalInfo: false,
    updateChannel: "stable",
    autoDownloadUpdates: false,
    installUpdatesOnQuit: false,
    globalShortcut: "Ctrl+Shift+U",
    codexCustomSessionsDirs: [],
    uiLanguage: "english",
    theme: "dark",
    windowScalePercent: 125,
    trayScalePercent: 100,
    powertoysStatusPipeEnabled: false,
    claudeAvoidKeychainPrompts: false,
    codexSparkUsageVisible: true,
    disableKeychainAccess: false,
    providerMetrics: {},
    floatBarEnabled: true,
    floatBarOpacity: 80,
    floatBarScale: 100,
    floatBarOrientation: "horizontal",
    floatBarStyle: "floating",
    floatBarClickThrough: false,
    floatBarProviderIds: [],
    floatBarDarkText: false,
    floatBarShowResetInline: false,
    floatBarShowCost: false,
    floatBarShowAccount: true,
    ...overrides,
  };
}

function bootstrap(settingsOverrides: Partial<SettingsSnapshot> = {}): BootstrapState {
  return {
    contractVersion: "v1",
    providers: [],
    settings: settings(settingsOverrides),
  };
}

function renderFloatBar(state: BootstrapState) {
  return render(
    <LocaleProvider>
      <FloatBar state={state} />
    </LocaleProvider>,
  );
}

describe("FloatBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "is_cursor_over_float_bar" ? false : undefined),
    );
    tauriMocks.refreshProviders.mockResolvedValue(undefined);
    tauriMocks.refreshProvidersIfStale.mockResolvedValue(undefined);
    tauriMocks.getLocaleStrings.mockResolvedValue(
      buildBundle({
        ResetsInHoursMinutes: "Resets in {}h {}m",
        ResetsInDaysHours: "Resets in {}d {}h",
        TrayResetsDueNow: "Resetting",
        DetailPaceTitle: "Pace",
        PanelFiveHours: "5h",
        PanelUsedSuffix: "used",
        ProviderWeeklyLabel: "Weekly",
        FloatBarNoProviders: "No providers",
        FloatBarRemainingSuffix: "remaining",
        SubscriptionCountdownLeft: "{} left",
      }),
    );
    eventMocks.listen.mockResolvedValue(() => {});
  });

  it("renders a pill per enabled provider, sorted by usage descending", async () => {
    tauriMocks.getCachedProviders.mockResolvedValue([
      snapshot("claude", "Claude", 20),
      snapshot("codex", "Codex", 75),
    ]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());
    await waitFor(() => {
      const pills = container.querySelectorAll(".floatbar__pill");
      expect(pills.length).toBe(2);
    });

    const titles = Array.from(container.querySelectorAll(".floatbar__pill")).map(
      (el) => el.getAttribute("title") ?? "",
    );
    // Highest used (codex, 75%) still sorts first; FloatBar stays on remaining.
    expect(titles[0]).toMatch(/Codex: 5h 25% remaining/);
    expect(titles[1]).toMatch(/Claude: 5h 80% remaining/);
  });

  it("keeps capacity and resets but renders no Pace DOM even when Pace is populated", async () => {
    const provider = snapshot("codex", "Codex", 75);
    const weeklyReset = new Date(
      Date.now() + 6 * 24 * 60 * 60_000 + 5 * 60 * 60_000,
    ).toISOString();
    provider.primary.windowMinutes = 5 * 60;
    provider.secondary = rateWindow(24, { resetsAt: weeklyReset });
    provider.secondary.windowMinutes = 7 * 24 * 60;
    provider.pace = {
      stage: "slightly_ahead",
      deltaPercent: -0.7,
      willLastToReset: true,
      etaSeconds: null,
      expectedUsedPercent: 75.7,
      actualUsedPercent: 75,
    };
    provider.weeklyPace = {
      stage: "behind",
      deltaPercent: 16.6,
      willLastToReset: false,
      etaSeconds: 5 * 24 * 60 * 60,
      expectedUsedPercent: 7.4,
      actualUsedPercent: 24,
    };
    tauriMocks.getCachedProviders.mockResolvedValue([provider]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings({ showAsUsed: false }));

    const { container } = renderFloatBar(bootstrap({ showAsUsed: false }));

    await waitFor(() => {
      const usage = container.querySelector(".floatbar__pill");
      expect(usage).not.toBeNull();
      expect(container.querySelectorAll(".floatbar__metrics-pill")).toHaveLength(0);
      expect(container.textContent).not.toContain("-0.7%");
      expect(container.textContent).not.toContain("+16.6%");
      expect(usage?.textContent).toContain("5h25%");
      expect(usage?.textContent).toContain("7d76%");
      expect(usage?.textContent).not.toContain("Weekly");
      expect(usage?.textContent).toMatch(/6d [45]h/);
      expect(usage?.querySelector('[data-usage-tone="orange"]')?.textContent).toBe("25%");
      expect(usage?.querySelector('[data-usage-tone="green"]')?.textContent).toBe("76%");
      expect(container.textContent).not.toContain("$");
      expect(container.textContent).not.toContain("Today");
      expect(container.textContent).not.toContain("30d");
    });
    expect(tauriMocks.getProviderChartData).not.toHaveBeenCalled();
  });

  it("renders account data immediately after its provider capacity pill", async () => {
    const codex = snapshot("codex", "Codex", 20);
    codex.planName = "ChatGPT Pro";
    const account = snapshot("chatgpt", "ChatGPT", 0);
    account.accountOnly = true;
    account.planName = "Pro";
    account.subscriptionEndsAt = new Date(
      Date.now() + (3 * 24 + 4) * 60 * 60_000,
    ).toISOString();
    account.sourceLabel = "web";
    tauriMocks.getCachedProviders.mockResolvedValue([codex, account]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());

    await waitFor(() => {
      const pills = container.querySelectorAll(
        ".floatbar__capacity, .floatbar__account",
      );
      expect(pills).toHaveLength(2);
      expect(pills[0]).toHaveClass("floatbar__capacity");
      expect(pills[1]).toHaveClass("floatbar__account");
      expect(pills[1]).toHaveTextContent("ChatGPT Pro · 3d 4h left");
      expect(container.querySelectorAll(".floatbar__account")).toHaveLength(1);
      expect(pills[1].querySelector("button, a")).toBeNull();
      expect(pills[1]).toHaveAttribute("data-tauri-drag-region");
    });
  });

  it("keeps account pills privacy-safe while showing plan and expiry", async () => {
    const codex = snapshot("codex", "Codex", 20);
    const account = snapshot("chatgpt", "ChatGPT", 0);
    account.accountOnly = true;
    account.planName = "Pro";
    account.subscriptionEndsAt = new Date(
      Date.now() + 2 * 24 * 60 * 60_000,
    ).toISOString();
    account.accountEmail = "private@example.com";
    account.accountOrganization = "Private Workspace";
    account.cost = {
      used: 199.99,
      limit: 500,
      remaining: 300.01,
      currencyCode: "USD",
      period: "monthly",
      resetsAt: null,
      formattedUsed: "$199.99",
      formattedLimit: "$500.00",
    };
    account.sourceLabel = "secret-session-token";
    tauriMocks.getCachedProviders.mockResolvedValue([codex, account]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());

    await waitFor(() => {
      const text = container.textContent ?? "";
      expect(text).toContain("ChatGPT Pro");
      expect(text).toContain("left");
      expect(text).not.toContain("private@example.com");
      expect(text).not.toContain("Private Workspace");
      expect(text).not.toContain("199.99");
      expect(text).not.toContain("secret-session-token");
    });
  });

  it("renders only the plan when Claude has no authoritative expiry", async () => {
    const claude = snapshot("claude", "Claude", 20);
    claude.planName = "Claude Max 5x";
    claude.subscriptionEndsAt = null;
    tauriMocks.getCachedProviders.mockResolvedValue([claude]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());

    await waitFor(() => {
      expect(container.querySelector(".floatbar__account")).toHaveTextContent(
        "Claude Max 5x",
      );
      expect(container.querySelector(".floatbar__metrics-pill")).toBeNull();
    });
  });

  it("removes account pills without reserving one when the setting is off", async () => {
    const provider = snapshot("codex", "Codex", 20);
    provider.planName = "Pro";
    tauriMocks.getCachedProviders.mockResolvedValue([provider]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(
      settings({ floatBarShowAccount: false }),
    );

    const { container } = renderFloatBar(
      bootstrap({ floatBarShowAccount: false }),
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".floatbar__capacity")).toHaveLength(1);
      expect(container.querySelector(".floatbar__account")).toBeNull();
    });
  });

  it("hides account pills when both plan and expiry are absent", async () => {
    tauriMocks.getCachedProviders.mockResolvedValue([
      snapshot("codex", "Codex", 20),
    ]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());

    await waitFor(() => {
      expect(container.querySelector(".floatbar__capacity")).not.toBeNull();
      expect(container.querySelector(".floatbar__account")).toBeNull();
    });
  });

  it("renders an account-only provider without a fabricated capacity pill", async () => {
    const provider = snapshot("chatgpt", "ChatGPT", 0);
    provider.accountOnly = true;
    provider.planName = "Plus";
    tauriMocks.getCachedProviders.mockResolvedValue([provider]);
    const overrides = { enabledProviders: ["chatgpt"] };
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings(overrides));

    const { container } = renderFloatBar(bootstrap(overrides));

    await waitFor(() => {
      expect(container.querySelector(".floatbar__capacity")).toBeNull();
      expect(container.querySelector(".floatbar__account")).toHaveTextContent(
        "ChatGPT Plus",
      );
      expect(container.querySelector(".floatbar__account")).not.toHaveTextContent(
        "5h",
      );
    });
  });

  it("refreshes account countdowns every minute and cleans up on unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T10:00:00Z"));
    try {
      const codex = snapshot("codex", "Codex", 20);
      const account = snapshot("chatgpt", "ChatGPT", 0);
      account.accountOnly = true;
      account.planName = "Pro";
      account.subscriptionEndsAt = "2026-07-20T11:01:00Z";
      tauriMocks.getCachedProviders.mockResolvedValue([codex, account]);
      tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

      let result!: ReturnType<typeof renderFloatBar>;
      await act(async () => {
        result = renderFloatBar(bootstrap());
      });
      await vi.waitFor(() => {
        expect(result.container.querySelector(".floatbar__account")).toHaveTextContent(
          "ChatGPT Pro · 1h 1m left",
        );
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(result.container.querySelector(".floatbar__account")).toHaveTextContent(
        "ChatGPT Pro · 1h 0m left",
      );

      result.unmount();
      await vi.advanceTimersByTimeAsync(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mislabel a weekly-only primary window as 5h", async () => {
    const provider = snapshot("codex", "Codex", 10, {
      resetsAt: new Date(Date.now() + 6 * 24 * 60 * 60_000).toISOString(),
    });
    provider.primary.windowMinutes = 7 * 24 * 60;
    provider.pace = {
      stage: "behind",
      deltaPercent: 8.7,
      willLastToReset: false,
      etaSeconds: null,
      expectedUsedPercent: 1.3,
      actualUsedPercent: 10,
    };
    tauriMocks.getCachedProviders.mockResolvedValue([provider]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings({ showAsUsed: false }));

    const { container } = renderFloatBar(bootstrap({ showAsUsed: false }));

    await waitFor(() => {
      const usage = container.querySelector(".floatbar__pill");
      expect(usage?.textContent).toContain("5h—");
      expect(usage?.textContent).toContain("7d90%");
      expect(usage?.getAttribute("title")).toContain("5h — / 7d 90% remaining");
      expect(container.querySelector(".floatbar__metrics-pill")).toBeNull();
      expect(container.textContent).not.toContain("+8.7%");
    });
  });

  it("renders an informational 5h placeholder as unavailable", async () => {
    const provider = snapshot("claude", "Claude", 0);
    provider.primary.windowMinutes = 5 * 60;
    provider.primary.isInformational = true;
    provider.secondary = rateWindow(20);
    provider.secondary.windowMinutes = 7 * 24 * 60;
    tauriMocks.getCachedProviders.mockResolvedValue([provider]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());

    await waitFor(() => {
      const usage = container.querySelector(".floatbar__pill");
      expect(usage?.textContent).toContain("5h\u2014");
      expect(usage?.textContent).toContain("7d80%");
      expect(usage?.textContent).not.toContain("5h100%");
      expect(usage?.getAttribute("title")).toContain(
        "5h \u2014 / 7d 80% remaining",
      );
    });
  });

  it("renders unavailable quota lanes red when the provider has an error", async () => {
    const provider = snapshot("claude", "Claude", 0, {
      error: "provider fetch failed",
    });
    provider.primary.windowMinutes = null;
    tauriMocks.getCachedProviders.mockResolvedValue([provider]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());

    await waitFor(() => {
      const values = Array.from(
        container.querySelectorAll<HTMLElement>(".floatbar__pct"),
      );
      expect(values.map((value) => value.textContent)).toEqual(["\u2014", "\u2014"]);
      expect(values.every((value) => value.dataset.usageTone === "red")).toBe(
        true,
      );
      expect(values.every((value) => value.dataset.unavailable === "true")).toBe(
        true,
      );
    });
  });

  it("keeps remaining percentages when menu details are configured as used", async () => {
    tauriMocks.getCachedProviders.mockResolvedValue([
      snapshot("claude", "Claude", 20),
    ]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings({ showAsUsed: true }));

    const { container } = renderFloatBar(bootstrap({ showAsUsed: true }));

    await waitFor(() => {
      const title = container
        .querySelector(".floatbar__pill")
        ?.getAttribute("title");
      expect(title).toContain("Claude: 5h 80% remaining");
    });
  });

  it("adds Claude's Fable-only remaining percentage as FA", async () => {
    const claude = snapshot("claude", "Claude", 20);
    claude.extraRateWindows = [
      {
        id: "claude-weekly-scoped-claude-fable-5-promo",
        title: "Fable only",
        window: rateWindow(61),
      },
    ];
    tauriMocks.getCachedProviders.mockResolvedValue([claude]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());

    await waitFor(() => {
      const usage = container.querySelector(".floatbar__pill");
      const fable = container.querySelector<HTMLElement>(
        '[data-usage-window="fable"]',
      );
      expect(fable?.textContent).toBe("FA39%");
      expect(fable?.querySelector('[data-usage-tone="yellow"]')?.textContent).toBe(
        "39%",
      );
      expect(fable?.querySelector(".floatbar__reset")).toBeNull();
      expect(usage?.getAttribute("title")).toContain("FA 39% remaining");
    });
  });

  it("shows Fable's own reset icon and compact time on the FA row", async () => {
    const weeklyReset = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString();
    const fableReset = new Date(
      Date.now() + 5 * 24 * 60 * 60_000 + 5 * 60 * 60_000,
    ).toISOString();
    const claude = snapshot("claude", "Claude", 20);
    claude.secondary = rateWindow(12, { resetsAt: weeklyReset });
    claude.secondary.windowMinutes = 7 * 24 * 60;
    claude.extraRateWindows = [
      {
        id: "claude-weekly-scoped-fable",
        title: "Fable only",
        window: rateWindow(7, { resetsAt: fableReset }),
      },
    ];
    tauriMocks.getCachedProviders.mockResolvedValue([claude]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());

    await waitFor(() => {
      const usage = container.querySelector(".floatbar__pill");
      const fable = container.querySelector<HTMLElement>(
        '[data-usage-window="fable"]',
      );
      const reset = fable?.querySelector<HTMLElement>(".floatbar__reset");
      expect(fable?.textContent).toMatch(/FA93%5d [45]h/);
      expect(reset?.getAttribute("aria-label")).toMatch(/Resets in 5d [45]h/);
      expect(reset?.textContent).toMatch(/5d [45]h/);
      expect(reset?.textContent).not.toContain("2d");
      expect(usage?.getAttribute("title")).toMatch(
        /FA 93% remaining, Resets in 5d [45]h/,
      );
    });
  });

  it("never renders FA for non-Claude providers", async () => {
    const codex = snapshot("codex", "Codex", 20);
    codex.extraRateWindows = [
      {
        id: "claude-weekly-scoped-fable",
        title: "Fable only",
        window: rateWindow(61),
      },
    ];
    tauriMocks.getCachedProviders.mockResolvedValue([codex]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());

    await waitFor(() => {
      expect(container.querySelector(".floatbar__pill")).not.toBeNull();
      expect(container.querySelector('[data-usage-window="fable"]')).toBeNull();
    });
  });

  it("colors remaining quota green, yellow, orange, and red at the requested thresholds", async () => {
    tauriMocks.getCachedProviders.mockResolvedValue([
      snapshot("green", "Green", 50),
      snapshot("yellow", "Yellow", 51),
      snapshot("orange", "Orange", 71),
      snapshot("red", "Red", 91),
    ]);
    const overrides = {
      enabledProviders: ["green", "yellow", "orange", "red"],
      showAsUsed: false,
    };
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings(overrides));

    const { container } = renderFloatBar(bootstrap(overrides));
    await waitFor(() => {
      const values = Object.fromEntries(
        Array.from(container.querySelectorAll<HTMLElement>("[data-usage-tone]")).map(
          (element) => [element.textContent, element.dataset.usageTone],
        ),
      );
      expect(values).toMatchObject({
        "50%": "green",
        "49%": "yellow",
        "29%": "orange",
        "9%": "red",
      });
    });
  });

  it("never renders signed Pace values for zero or non-zero Pace", async () => {
    const provider = snapshot("codex", "Codex", 50);
    provider.pace = {
      stage: "on_track",
      deltaPercent: 0,
      willLastToReset: true,
      etaSeconds: null,
      expectedUsedPercent: 50,
      actualUsedPercent: 50,
    };
    tauriMocks.getCachedProviders.mockResolvedValue([provider]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());
    await waitFor(() => {
      expect(container.querySelector("[data-pace-tone]")).toBeNull();
      expect(container.querySelector(".floatbar__metrics-pill")).toBeNull();
      expect(container.textContent).not.toContain("0.0%");
    });
  });

  it("filters to the floatBarProviderIds allowlist when non-empty", async () => {
    tauriMocks.getCachedProviders.mockResolvedValue([
      snapshot("claude", "Claude", 30),
      snapshot("codex", "Codex", 50),
    ]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(
      settings({ floatBarProviderIds: ["codex"] }),
    );

    const { container } = renderFloatBar(
      bootstrap({ floatBarProviderIds: ["codex"] }),
    );
    await waitFor(() => {
      const pills = container.querySelectorAll(".floatbar__pill");
      expect(pills.length).toBe(1);
      expect(pills[0].getAttribute("title")).toMatch(/Codex/);
    });
  });

  it("does not show stale cached providers when all providers are disabled", async () => {
    tauriMocks.getCachedProviders.mockResolvedValue([
      snapshot("claude", "Claude", 30),
      snapshot("codex", "Codex", 50),
    ]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(
      settings({ enabledProviders: [] }),
    );

    const { container } = renderFloatBar(bootstrap({ enabledProviders: [] }));
    await waitFor(() => {
      expect(container.querySelectorAll(".floatbar__pill").length).toBe(0);
      expect(container.querySelector(".floatbar__empty")).not.toBeNull();
    });
  });

  it("shows an empty state when no providers match", async () => {
    tauriMocks.getCachedProviders.mockResolvedValue([]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());
    await waitFor(() => {
      expect(container.querySelector(".floatbar__empty")).not.toBeNull();
    });
  });

  it("applies the light-background class and CSS opacity", async () => {
    tauriMocks.getCachedProviders.mockResolvedValue([]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(
      settings({ floatBarDarkText: true, floatBarOpacity: 45 }),
    );

    const { container } = renderFloatBar(
      bootstrap({ floatBarDarkText: true, floatBarOpacity: 45 }),
    );

    await waitFor(() => {
      const bar = container.querySelector<HTMLElement>(".floatbar");
      expect(bar).not.toBeNull();
      expect(bar?.classList.contains("floatbar--light-bg")).toBe(true);
      expect(bar?.classList.contains("floatbar--dark-contrast")).toBe(true);
      expect(bar?.style.opacity).toBe("0.45");
      expect(container.querySelector(".floatbar__handle")).not.toBeNull();
    });
  });

  it("hides the grip and becomes 10% opaque when click-through is hovered", async () => {
    coreMocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "is_cursor_over_float_bar" ? true : undefined),
    );
    tauriMocks.getCachedProviders.mockResolvedValue([]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(
      settings({ floatBarClickThrough: true }),
    );

    const { container } = renderFloatBar(
      bootstrap({ floatBarClickThrough: true }),
    );

    await waitFor(() => {
      const bar = container.querySelector<HTMLElement>(".floatbar");
      expect(bar?.style.opacity).toBe("0.1");
      expect(container.querySelector(".floatbar__handle")).toBeNull();
      expect(coreMocks.invoke).toHaveBeenCalledWith("is_cursor_over_float_bar");
    });
  });

  it("applies the configured scale as a CSS variable", async () => {
    tauriMocks.getCachedProviders.mockResolvedValue([]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings({ floatBarScale: 150 }));

    const { container } = renderFloatBar(bootstrap({ floatBarScale: 150 }));

    await waitFor(() => {
      const bar = container.querySelector<HTMLElement>(".floatbar");
      expect(bar).not.toBeNull();
      expect(bar?.style.getPropertyValue("--floatbar-scale")).toBe("1.5");
    });
  });

  it("keeps X notifications out of the FloatBar", async () => {
    tauriMocks.getCachedProviders.mockResolvedValue([]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container, queryByRole } = renderFloatBar(bootstrap());
    await waitFor(() => {
      expect(container.querySelector(".floatbar")).not.toBeNull();
    });

    expect(queryByRole("button", { name: /X notifications/i })).toBeNull();
    expect(container.querySelector(".tray-x-notifications__panel")).toBeNull();
  });

  it("uses the localized reset formatter in pill tooltips", async () => {
    const resetsAt = new Date(Date.now() + 3 * 60 * 60_000 + 42 * 60_000).toISOString();
    tauriMocks.getCachedProviders.mockResolvedValue([
      snapshot("claude", "Claude", 20, { resetsAt }),
    ]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());

    const { container } = renderFloatBar(bootstrap());

    await waitFor(() => {
      const title = container
        .querySelector(".floatbar__pill")
        ?.getAttribute("title");
      expect(title).toContain("Claude: 5h 80% remaining");
      expect(title).toMatch(/Resets in 3h 4[12]m/);
      expect(title).not.toContain("Resets in due now");
    });
  });

  it("can render a next reset icon and time in provider pills", async () => {
    const resetsAt = new Date(Date.now() + 2 * 60 * 60_000 + 5 * 60_000).toISOString();
    tauriMocks.getCachedProviders.mockResolvedValue([
      snapshot("claude", "Claude", 20, { resetsAt }),
    ]);
    tauriMocks.getSettingsSnapshot.mockResolvedValue(
      settings({ floatBarShowResetInline: true }),
    );

    const { container } = renderFloatBar(
      bootstrap({ floatBarShowResetInline: true }),
    );

    await waitFor(() => {
      const reset = container.querySelector(".floatbar__reset");
      expect(reset).not.toBeNull();
      expect(reset?.getAttribute("aria-label")).toMatch(/Resets in 2h [45]m/);
      expect(reset?.textContent).toMatch(/2h [45]m/);
      expect(reset?.textContent).not.toContain("Resets in");
    });
  });

  it("polls refreshProvidersIfStale on the configured interval", async () => {
    vi.useFakeTimers();
    try {
      tauriMocks.getCachedProviders.mockResolvedValue([]);
      tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());
      // 60s minimum is enforced in FloatBar.tsx; use the floor here.
      await act(async () => {
        renderFloatBar(bootstrap({ refreshIntervalSecs: 60 }));
      });

      // Initial tick fires synchronously on mount; useProviders is passive here
      // so the floatbar does not double-request stale refreshes at startup.
      await vi.waitFor(() => {
        expect(tauriMocks.refreshProvidersIfStale).toHaveBeenCalledTimes(1);
      });
      const initialCalls = tauriMocks.refreshProvidersIfStale.mock.calls.length;

      // Advance the timer past the 60-second interval — the floatbar tick
      // should fire again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(tauriMocks.refreshProvidersIfStale.mock.calls.length).toBeGreaterThan(
        initialCalls,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
