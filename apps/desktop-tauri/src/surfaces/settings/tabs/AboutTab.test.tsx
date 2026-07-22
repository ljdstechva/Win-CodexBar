import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  getAppInfo: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("../../../lib/tauri", () => tauriMocks);
vi.mock("../../../hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

import AboutTab from "./AboutTab";

describe("AboutTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.getAppInfo.mockResolvedValue({
      name: "CodexBar",
      version: "0.42.0",
      buildNumber: "dev",
      updateChannel: "stable",
      tagline: "Keep agent limits in view.",
    });
    tauriMocks.openExternalUrl.mockResolvedValue(undefined);
  });

  it("replaces updater controls with the original repository link", async () => {
    render(<AboutTab settings={{} as never} set={vi.fn()} saving={false} />);

    const watchLink = await screen.findByRole("button", {
      name: "Watch steipete/CodexBar on GitHub",
    });
    expect(screen.queryByRole("button", { name: /check for updates/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^download$/i })).toBeNull();
    fireEvent.click(watchLink);

    expect(tauriMocks.openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/steipete/CodexBar",
    );
  });

  it("shows a link error if the OS browser launch fails", async () => {
    tauriMocks.openExternalUrl.mockRejectedValue("no browser");
    render(<AboutTab settings={{} as never} set={vi.fn()} saving={false} />);

    fireEvent.click(await screen.findByRole("button", { name: "AboutLinkWebsite" }));
    await waitFor(() => {
      expect(screen.getByText("ErrorPrefix no browser")).toBeInTheDocument();
    });
  });
});
