import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppErrorBoundary from "./AppErrorBoundary";

function BrokenSurface(): never {
  throw new Error("test render failure");
}

describe("AppErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children while the interface is healthy", () => {
    render(
      <AppErrorBoundary>
        <div>Healthy surface</div>
      </AppErrorBoundary>,
    );

    expect(screen.getByText("Healthy surface")).toBeInTheDocument();
  });

  it("shows a visible recovery screen after a render failure", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <BrokenSurface />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("CodexBar could not render");
    expect(screen.getByRole("button", { name: "Reload CodexBar" })).toBeInTheDocument();
  });
});
