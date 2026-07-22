import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
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
import MenuSurface, { MenuSummary } from "./MenuSurface";

function renderSummary(total: number) {
  return render(
    <LocaleProvider>
      <MenuSummary
        total={total}
        errorCount={0}
        isRefreshing={false}
        lastRefresh={null}
      />
    </LocaleProvider>,
  );
}

describe("MenuSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.getLocaleStrings.mockResolvedValue(
      buildBundle({ SummaryProvidersLabel: "providers" }),
    );
    eventMocks.listen.mockResolvedValue(() => {});
  });

  it("uses a singular provider label for one provider", async () => {
    renderSummary(1);

    expect(await screen.findByText("1 provider")).toBeInTheDocument();
  });

  it("keeps the plural provider label for multiple providers", async () => {
    renderSummary(2);

    expect(await screen.findByText("2 providers")).toBeInTheDocument();
  });
});

describe("MenuSurface toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.getLocaleStrings.mockResolvedValue(
      buildBundle({ TooltipRefresh: "Refresh" }),
    );
    eventMocks.listen.mockResolvedValue(() => {});
  });

  it("renders working refresh and surface action buttons", async () => {
    const onRefresh = vi.fn();
    const onBackToTray = vi.fn();

    render(
      <LocaleProvider>
        <MenuSurface
          variant="popout"
          onRefresh={onRefresh}
          isRefreshing={false}
          actions={[
            { icon: "↙", title: "Back to tray", onClick: onBackToTray },
          ]}
        >
          <div>Dashboard</div>
        </MenuSurface>
      </LocaleProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to tray" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onBackToTray).toHaveBeenCalledTimes(1);
  });

  it("disables and animates refresh while a request is active", async () => {
    render(
      <LocaleProvider>
        <MenuSurface
          variant="tray"
          onRefresh={vi.fn()}
          isRefreshing
          actions={[]}
        >
          <div>Dashboard</div>
        </MenuSurface>
      </LocaleProvider>,
    );

    const refresh = await screen.findByRole("button", { name: "Refresh" });
    expect(refresh).toBeDisabled();
    expect(refresh.querySelector(".spin")).not.toBeNull();
  });
});
