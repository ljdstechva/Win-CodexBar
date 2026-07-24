import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  getProviderChartData: vi.fn(),
  getCodexResetHistory: vi.fn(),
  getProofState: vi.fn(),
  openExternalUrl: vi.fn(),
  getLocaleStrings: vi.fn(),
  setUiLanguage: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/tauri")>()),
  ...tauriMocks,
}));
vi.mock("@tauri-apps/api/event", () => eventMocks);

import { LocaleProvider } from "../i18n/LocaleProvider";
import { buildBundle } from "../test/localeHarness";
import type { ProviderUsageSnapshot } from "../types/bridge";
import MenuCard from "./MenuCard";

function rateWindow(
  usedPercent = 0,
  opts: {
    exhausted?: boolean;
    resetDescription?: string | null;
    reservePercent?: number | null;
    reserveDescription?: string | null;
    reserveWillLastToReset?: boolean;
    reserveEtaSeconds?: number | null;
    windowMinutes?: number | null;
    resetsAt?: string | null;
  } = {},
) {
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowMinutes: opts.windowMinutes ?? null,
    resetsAt: opts.resetsAt ?? null,
    resetDescription: opts.resetDescription ?? null,
    isExhausted: opts.exhausted ?? false,
    reservePercent: opts.reservePercent ?? null,
    reserveDescription: opts.reserveDescription ?? null,
    reserveWillLastToReset: opts.reserveWillLastToReset ?? false,
    reserveEtaSeconds: opts.reserveEtaSeconds ?? null,
  };
}

function provider(
  error: string | null,
  usedPercent = 0,
  opts: { exhausted?: boolean; resetDescription?: string | null } = {},
): ProviderUsageSnapshot {
  return {
    providerId: "claude",
    displayName: "Claude",
    primary: rateWindow(usedPercent, opts),
    primaryLabel: "Session",
    secondary: null,
    modelSpecific: null,
    tertiary: null,
    extraRateWindows: [],
    cost: null,
    planName: null,
    subscriptionEndsAt: null,
    accountEmail: null,
    sourceLabel: "oauth",
    updatedAt: "2026-05-24T00:00:00Z",
    error,
    pace: null,
    weeklyPace: null,
    accountOrganization: null,
    trayStatusLabel: null,
    fetchDurationMs: null,
  };
}

function renderCard(
  snapshot: ProviderUsageSnapshot,
  opts: {
    showAsUsed?: boolean;
    showResetWhenExhausted?: boolean;
    isRefreshing?: boolean;
    onLayoutChange?: () => void;
  } = {},
) {
  return render(
    <LocaleProvider>
      <MenuCard
        provider={snapshot}
        hideEmail={false}
        resetTimeRelative={true}
        showResetWhenExhausted={opts.showResetWhenExhausted}
        showAsUsed={opts.showAsUsed}
        isRefreshing={opts.isRefreshing}
        onLayoutChange={opts.onLayoutChange}
      />
    </LocaleProvider>,
  );
}

describe("MenuCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.getLocaleStrings.mockResolvedValue(
      buildBundle({
        ActionCopyError: "Copy error",
        DetailWindowExhausted: "Exhausted",
        DetailCostTitle: "Cost",
        DetailPaceBehind: "Behind",
        DetailPaceRunsOutIn: "Runs out in",
        DetailPaceTitle: "Pace",
        DetailPaceWillLastToReset: "Will last to reset",
        PanelActual: "Actual",
        PanelEstimatedFromLocalLogs: "Estimated from local logs",
        PanelExpected: "Expected",
        PanelLeftSuffix: "left",
        PanelNow: "now",
        PanelOneHour: "1h",
        PanelFiveHours: "5h",
        PanelOnPaceBudget: "On-pace budget",
        PanelReserveSuffix: "in reserve",
        PanelThirtyDayCost: "30d cost",
        PanelThirtyDayTokens: "30d tokens",
        PanelTodayBudget: "today",
        PanelUsedSuffix: "used",
        ProviderWeeklyLabel: "Weekly",
        SubscriptionCountdownLeft: "{} left",
        ResetHistoryButton: "Reset history",
        ResetHistoryHeading: "Reset history",
        ResetHistoryDescription: "Banked credits and reset announcements",
        ResetHistoryRefresh: "Refresh",
        ResetHistoryLoading: "Loading…",
        ResetHistoryLoadFailed: "Reset history could not be loaded.",
        ResetHistoryEmpty: "No reset credits recorded yet.",
        ResetHistoryBanked: "BANKED",
        ResetHistoryNonBanked: "NON-BANKED",
        ResetHistoryAvailable: "Available",
        ResetHistoryExpiresIn: "Expires in {}d {}h",
        ResetHistoryRedeemed: "Redeemed",
        ResetHistoryRedeemedOn: "Redeemed {}",
        ResetHistoryExpired: "Expired",
        ResetHistoryStale: "Showing saved history.",
        ResetHistoryOpenAnnouncement: "Open {}",
        ResetsInHoursMinutes: "Resets in {}h {}m",
        ResetsInMinutes: "Resets in {}m",
        WayfinderGatewayStatus: "Gateway",
        WayfinderModels: "Models",
        WayfinderRequests: "Requests",
        WayfinderTokens: "Tokens",
        WayfinderSaved: "Saved",
        WayfinderOffline: "Gateway offline",
        WayfinderDryRun: "Dry run",
        WayfinderMissingKeys: "Missing keys",
      }),
    );
    tauriMocks.getProviderChartData.mockResolvedValue({
      providerId: "claude",
      costHistory: [{ date: "2026-05-24", value: 1.23 }],
      creditsHistory: [],
      usageBreakdown: [],
      localUsage: {
        todayCost: null,
        thirtyDayCost: 1.23,
        thirtyDayTokens: 584_000,
        latestTokens: 123_000,
        topModel: "glim-4.6",
        estimateNote: "Estimated from local logs",
        tokenCostUpdatedAtMs: 1234,
      },
    });
    tauriMocks.getCodexResetHistory.mockResolvedValue({
      entries: [],
      stale: false,
    });
    tauriMocks.getProofState.mockRejectedValue(new Error("proof disabled"));
    tauriMocks.openExternalUrl.mockResolvedValue(undefined);
    eventMocks.listen.mockResolvedValue(() => {});
  });

  it("renders reset history only at the bottom of the Codex card", async () => {
    const claudeRender = renderCard(provider(null));
    expect(
      screen.queryByRole("button", { name: "Reset history" }),
    ).not.toBeInTheDocument();
    claudeRender.unmount();

    const snapshot = provider(null);
    snapshot.providerId = "codex";
    snapshot.displayName = "Codex";
    const { container } = renderCard(snapshot);

    const trigger = await screen.findByRole("button", {
      name: "Reset history",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector(".menu-card")?.lastElementChild,
    ).toHaveClass("codex-reset-history");
  });

  it("shows banked and non-banked reset history and opens the exact X URL", async () => {
    tauriMocks.getCodexResetHistory.mockResolvedValue({
      stale: false,
      entries: [
        {
          kind: "announced",
          postId: "1888123456789012345",
          postDate: "2026-07-15T11:00:00Z",
          handle: "OpenAI",
          url: "https://x.com/OpenAI/status/1888123456789012345",
          snippet: "Codex rate limits have been reset for everyone.",
          recordedAt: "2026-07-15T11:05:00Z",
        },
        {
          kind: "banked",
          id: "RateLimitResetCredit_1",
          grantedAt: "2026-07-13T17:49:11Z",
          expiresAt: "2099-08-12T17:49:11Z",
          redeemedAt: null,
          redeemStartedAt: null,
          status: "available",
          title: "Full reset",
          description: "Reset all Codex rate limits.",
          grantor: "Codex Team",
          resetType: "codex_rate_limits",
          recordedAt: "2026-07-14T00:00:00Z",
        },
      ],
    });
    const snapshot = provider(null);
    snapshot.providerId = "codex";
    snapshot.displayName = "Codex";
    const { container } = renderCard(snapshot);

    const trigger = await screen.findByRole("button", {
      name: "Reset history",
    });
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      await screen.findByRole("region", { name: "Reset history" }),
    ).toBeInTheDocument();
    expect(screen.getByText("BANKED")).toBeInTheDocument();
    expect(screen.getByText("NON-BANKED")).toBeInTheDocument();
    expect(screen.getByText("Full reset")).toBeInTheDocument();
    expect(screen.getByText("Codex Team")).toBeInTheDocument();
    expect(screen.getByText(/Available · Expires in \d+d \d+h/)).toBeInTheDocument();
    expect(
      screen.getByText("Codex rate limits have been reset for everyone."),
    ).toBeInTheDocument();

    fireEvent.click(
      container.querySelector(".codex-reset-history__item--link")!,
    );
    expect(tauriMocks.openExternalUrl).toHaveBeenCalledWith(
      "https://x.com/OpenAI/status/1888123456789012345",
    );
  });

  it("closes reset history on Escape and outside pointer input", async () => {
    const snapshot = provider(null);
    snapshot.providerId = "codex";
    const { container } = renderCard(snapshot);
    const trigger = await screen.findByRole("button", {
      name: "Reset history",
    });

    fireEvent.click(trigger);
    await screen.findByRole("region", { name: "Reset history" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("region", { name: "Reset history" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    await screen.findByRole("region", { name: "Reset history" });
    fireEvent.pointerDown(document.body);
    expect(
      container.querySelector(".codex-reset-history__panel"),
    ).not.toBeInTheDocument();
  });

  it("opens reset history automatically only for an explicit proof request", async () => {
    tauriMocks.getProofState.mockResolvedValue({
      mode: "trayPanel",
      target: { kind: "summary" },
      windowRect: null,
      trayAnchor: null,
      workArea: null,
      menuPath: null,
      menuItems: [],
      xNotificationsOpen: false,
      resetHistoryOpen: true,
    });
    const snapshot = provider(null);
    snapshot.providerId = "codex";

    renderCard(snapshot);

    expect(
      await screen.findByRole("region", { name: "Reset history" }),
    ).toBeInTheDocument();
    expect(tauriMocks.getCodexResetHistory).toHaveBeenCalled();
  });

  it("does not mix stale local usage into an error card", async () => {
    const { container } = renderCard(
      provider("OAuth error: Claude OAuth credentials not found."),
    );

    expect(
      await screen.findByText("OAuth error: Claude OAuth credentials not found."),
    ).toBeInTheDocument();
    expect(container.querySelector(".menu-card--header-only")).toBeInTheDocument();
    expect(container.querySelector(".menu-card--with-details")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(tauriMocks.getProviderChartData).toHaveBeenCalled();
    });

    expect(screen.queryByText("30d cost")).not.toBeInTheDocument();
    expect(screen.queryByText("30d tokens")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated from local logs")).not.toBeInTheDocument();
  });

  it("can render metric bars as used instead of remaining", async () => {
    renderCard(provider(null, 35), { showAsUsed: true });

    expect(await screen.findByText("35% used")).toBeInTheDocument();
    expect(screen.queryByText("65% left")).not.toBeInTheDocument();

    const fill = document.querySelector<HTMLElement>(".menu-metric__bar-fill");
    expect(fill?.style.width).toBe("35%");
  });

  it("displays over-quota usage without overflowing the bar", async () => {
    renderCard(provider(null, 115, { exhausted: true, resetDescription: "115% used" }), {
      showAsUsed: true,
    });

    expect(await screen.findAllByText("115% used")).not.toHaveLength(0);
    const fill = document.querySelector<HTMLElement>(".menu-metric__bar-fill");
    expect(fill?.style.width).toBe("100%");
  });

  it("replaces an exhausted percentage with a concrete future reset", async () => {
    const snapshot = provider(null, 100, { exhausted: true });
    snapshot.primary.resetsAt = new Date(
      Date.now() + 60 * 60 * 1000,
    ).toISOString();

    renderCard(snapshot, { showResetWhenExhausted: true });

    expect(await screen.findByText(/Resets in \d+m/)).toBeInTheDocument();
    expect(screen.queryByText("0% left")).not.toBeInTheDocument();
  });

  it("keeps an exhausted percentage without a concrete future reset", async () => {
    renderCard(provider(null, 100, {
      exhausted: true,
      resetDescription: "in 2h",
    }), { showResetWhenExhausted: true });

    expect(await screen.findByText("0% left")).toBeInTheDocument();
  });

  it("marks a provider card busy while that provider refreshes", async () => {
    const { container } = renderCard(provider(null), { isRefreshing: true });

    await screen.findByText("Claude");
    expect(container.querySelector(".menu-card")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("adds a localized future countdown and absolute tooltip to the plan badge", async () => {
    const snapshot = provider(null);
    snapshot.planName = "Pro";
    snapshot.subscriptionEndsAt = new Date(
      Date.now() + (3 * 24 + 4) * 60 * 60 * 1000,
    ).toISOString();

    renderCard(snapshot);

    const badge = await screen.findByText("Pro · 3d 4h left");
    expect(badge).toHaveAttribute(
      "title",
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(snapshot.subscriptionEndsAt)),
    );
  });

  it("keeps a stale subscription badge plan-only", async () => {
    const snapshot = provider(null);
    snapshot.planName = "Pro";
    snapshot.subscriptionEndsAt = "2020-01-01T00:00:00Z";

    const { container } = renderCard(snapshot);

    expect(await screen.findByText("Pro")).toBeInTheDocument();
    expect(container.querySelector(".menu-card__plan-badge")).toHaveTextContent(
      "Pro",
    );
    expect(container.querySelector(".menu-card__plan-badge")).not.toHaveTextContent(
      "left",
    );
  });

  it("renders informational metrics without quota percentages", async () => {
    const snapshot = provider(null, 20);
    snapshot.extraRateWindows = [
      {
        id: "requests",
        title: "Requests",
        window: {
          ...rateWindow(0),
          isInformational: true,
          resetDescription: "7 requests",
        },
      },
    ];

    renderCard(snapshot);

    const title = await screen.findByText("Requests");
    expect(title.parentElement).not.toHaveTextContent("100% left");
    expect(title.parentElement?.querySelector(".menu-metric__bar")).toBeNull();
    expect(screen.getByText("7 requests")).toBeInTheDocument();
  });

  it("renders Wayfinder telemetry without quota or identity rows", async () => {
    const snapshot = provider(null);
    snapshot.providerId = "wayfinder";
    snapshot.displayName = "Wayfinder";
    snapshot.accountEmail = "should-not-render@example.test";
    snapshot.planName = "should-not-render";
    snapshot.wayfinderUsage = {
      gatewayStatus: "ok",
      offline: false,
      dryRun: false,
      missingKeys: [],
      modelCount: 2,
      models: ["model-a", "model-b"],
      requests: 14,
      estimatedRequests: 0,
      tokens: 1028,
      realized: 0.004,
      baseline: 0.01,
      saved: 0.006,
      savedPercent: 60,
      periodDays: 30,
      unit: "usd",
      priced: true,
      routes: [],
    };

    renderCard(snapshot);

    expect(await screen.findByText("ok")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1K")).toBeInTheDocument();
    expect(screen.queryByText("should-not-render@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("should-not-render")).not.toBeInTheDocument();
    expect(screen.queryByText("Session")).not.toBeInTheDocument();
  });

  it("renders additional Copilot budget windows", async () => {
    const snapshot = provider(null, 20);
    snapshot.providerId = "copilot";
    snapshot.displayName = "GitHub Copilot";
    snapshot.extraRateWindows = [
      {
        id: "additional_budget",
        title: "Additional Budget",
        window: rateWindow(42),
      },
    ];

    renderCard(snapshot);

    expect(await screen.findByText("Additional Budget")).toBeInTheDocument();
    expect(screen.getByText("58% left")).toBeInTheDocument();
  });

  it("notifies the tray panel after async local usage data loads", async () => {
    const onLayoutChange = vi.fn();

    renderCard(provider(null), { onLayoutChange });

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalled();
    });
  });

  it("shows the formatted predicted exhaustion time", async () => {
    const snapshot = provider(null, 40);
    snapshot.pace = {
      stage: "far_ahead",
      deltaPercent: 20,
      expectedUsedPercent: 20,
      actualUsedPercent: 40,
      etaSeconds: 90 * 60,
      willLastToReset: false,
    };

    const { container } = renderCard(snapshot);

    await waitFor(() => {
      expect(container.querySelector(".menu-card__pace-eta")).toHaveTextContent(
        "⚠ Runs out in 2h",
      );
    });
  });

  it("keeps token totals while removing every cost and model summary", async () => {
    const snapshot = provider(null);
    snapshot.cost = {
      used: 9,
      limit: 20,
      remaining: 11,
      currencyCode: "USD",
      period: "month",
      resetsAt: null,
      formattedUsed: "$9.00",
      formattedLimit: "$20.00",
    };
    const { container } = renderCard(snapshot);

    expect(await screen.findByText("30d tokens")).toBeInTheDocument();
    expect(container.querySelector(".menu-card--with-details")).toBeInTheDocument();
    expect(container.querySelector(".menu-card--header-only")).not.toBeInTheDocument();
    expect(screen.getByText("584K")).toBeInTheDocument();
    expect(screen.getByText("123K")).toBeInTheDocument();
    expect(screen.queryByText("30d cost")).not.toBeInTheDocument();
    expect(screen.queryByText("$1.23")).not.toBeInTheDocument();
    expect(screen.queryByText("$9.00")).not.toBeInTheDocument();
    expect(screen.queryByText("Cost")).not.toBeInTheDocument();
    expect(screen.queryByText("glim-4.6")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated from local logs")).not.toBeInTheDocument();
    expect(container.querySelector(".menu-card__local-chart")).not.toBeInTheDocument();
  });

  it("renders the original two-track Pace bar with a 5h label", async () => {
    const snapshot = provider(null, 55);
    snapshot.primary = rateWindow(55, { windowMinutes: 5 * 60 });
    snapshot.pace = {
      stage: "behind",
      deltaPercent: -9.5,
      willLastToReset: true,
      etaSeconds: null,
      expectedUsedPercent: 44.5,
      actualUsedPercent: 55,
    };

    const { container } = renderCard(snapshot);

    expect(await screen.findByText("5h Pace")).toBeInTheDocument();
    expect(screen.getByText("Behind (-9.5%)")).toBeInTheDocument();
    expect(screen.getByText(/Will last to reset/)).toBeInTheDocument();
    const pace = container.querySelector(".menu-card__pace");
    expect(pace).toBeInTheDocument();
    expect(
      pace?.querySelector<HTMLElement>(".menu-card__pace-fill--expected")
        ?.style.width,
    ).toBe("44.5%");
    expect(
      pace?.querySelector<HTMLElement>(".menu-card__pace-fill:not(.menu-card__pace-fill--expected)")
        ?.style.width,
    ).toBe("55%");
  });

  it("renders a distinct weekly Pace bar from the weekly snapshot", async () => {
    const snapshot = provider(null, 55);
    snapshot.primary = rateWindow(55, { windowMinutes: 5 * 60 });
    snapshot.secondary = rateWindow(40, { windowMinutes: 7 * 24 * 60 });
    snapshot.secondaryLabel = "Weekly";
    snapshot.pace = {
      stage: "slightly_ahead",
      deltaPercent: 4,
      willLastToReset: false,
      etaSeconds: 3 * 60 * 60,
      expectedUsedPercent: 51,
      actualUsedPercent: 55,
    };
    snapshot.weeklyPace = {
      stage: "behind",
      deltaPercent: -10,
      willLastToReset: true,
      etaSeconds: null,
      expectedUsedPercent: 50,
      actualUsedPercent: 40,
    };

    const { container } = renderCard(snapshot);

    expect(await screen.findByText("5h Pace")).toBeInTheDocument();
    expect(screen.getByText("Weekly Pace")).toBeInTheDocument();
    expect(container.querySelectorAll(".menu-card__pace-window")).toHaveLength(2);

    const weekly = container.querySelector('[data-pace-window="weekly"]');
    expect(weekly).toHaveTextContent("Behind (-10.0%)");
    expect(weekly).toHaveTextContent("Will last to reset");
    expect(
      weekly?.querySelector<HTMLElement>(".menu-card__pace-fill--expected")
        ?.style.width,
    ).toBe("50%");
    expect(
      weekly?.querySelector<HTMLElement>(
        ".menu-card__pace-fill:not(.menu-card__pace-fill--expected)",
      )?.style.width,
    ).toBe("40%");
  });

  it("shows the time remaining before the current pace exhausts quota", async () => {
    const snapshot = provider(null, 55);
    snapshot.primary = rateWindow(55, { windowMinutes: 5 * 60 });
    snapshot.pace = {
      stage: "behind",
      deltaPercent: -9.5,
      willLastToReset: false,
      etaSeconds: 3.5 * 60 * 60,
      expectedUsedPercent: 44.5,
      actualUsedPercent: 55,
    };

    const { container } = renderCard(snapshot);

    await screen.findByText("5h Pace");
    expect(container.querySelector(".menu-card__pace-eta")).toHaveTextContent(
      "Runs out in 4h",
    );
  });

  it("shows on-pace budgets and expands projection details", async () => {
    const onLayoutChange = vi.fn();
    const resetAt = new Date(
      Date.now() + 0.6 * 7 * 24 * 60 * 60 * 1000,
    );
    const snapshot = provider(null, 20);
    snapshot.primary = rateWindow(20, {
      reservePercent: 20,
      reserveWillLastToReset: true,
      windowMinutes: 7 * 24 * 60,
      resetsAt: resetAt.toISOString(),
    });

    renderCard(snapshot, { onLayoutChange });

    const toggle = await screen.findByRole("button", { name: /On-pace budget/ });
    expect(screen.getByText("now 20%")).toBeInTheDocument();
    expect(screen.getByText("1h 21%")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /PaceChartAriaLabel/i })).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("img", { name: /PaceChartAriaLabel/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalled();
    });
  });

  it("shows on-pace budgets when timing exists without reserve metadata", async () => {
    const resetAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const snapshot = provider(null, 31);
    snapshot.primary = rateWindow(31, {
      windowMinutes: 7 * 24 * 60,
      resetsAt: resetAt.toISOString(),
    });

    renderCard(snapshot);

    expect(
      await screen.findByRole("button", { name: /On-pace budget/ }),
    ).toBeInTheDocument();
      expect(screen.getByText("now 0%")).toBeInTheDocument();
      expect(screen.queryByText(/in reserve/)).not.toBeInTheDocument();
      expect(screen.queryByText("Lasts until reset")).not.toBeInTheDocument();
  });

  it("does not show pace budgets for a five-hour session window", async () => {
    const resetAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const snapshot = provider(null, 31);
    snapshot.primary = rateWindow(31, {
      windowMinutes: 5 * 60,
      resetsAt: resetAt.toISOString(),
    });

    renderCard(snapshot);

    expect(await screen.findByText("69% left")).toBeInTheDocument();
    expect(screen.queryByText("On-pace budget")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /PaceChartAriaLabel/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the reserve row when timing data is incomplete", async () => {
    const snapshot = provider(null, 20);
    snapshot.primary = rateWindow(20, {
        reservePercent: 12,
        reserveWillLastToReset: true,
      });

    renderCard(snapshot);

    expect(await screen.findByText("12% in reserve")).toBeInTheDocument();
    expect(screen.queryByText("On-pace budget")).not.toBeInTheDocument();
  });

  it("localizes the relative updated-at time in Japanese without duplicated prefix", async () => {
    tauriMocks.getLocaleStrings.mockResolvedValue(
      buildBundle({
        UpdatedJustNow: "たった今",
        UpdatedMinutesAgo: "{}分前",
        UpdatedHoursAgo: "{}時間前",
        UpdatedDaysAgo: "{}日前",
      }),
    );

    const snapshot = provider(null, 20);
    snapshot.updatedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    renderCard(snapshot);

    expect(await screen.findByText("3分前")).toBeInTheDocument();
  });
});
