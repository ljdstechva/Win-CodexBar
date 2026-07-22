import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  focusAgentSession: vi.fn(),
  listAgentSessions: vi.fn(),
}));

vi.mock("../lib/tauri", () => tauri);
vi.mock("../hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

import AgentSessions from "./AgentSessions";

describe("AgentSessions", () => {
  it("keeps discovered sessions in a bounded list with full workspace details", async () => {
    tauri.listAgentSessions.mockResolvedValue({
      status: "hosts",
      hosts: [
        {
          host: "localhost",
          error: null,
          sessions: [
            {
              id: "session-1",
              provider: "codex",
              source: "cli",
              state: "active",
              pid: 42,
              transcriptPath: null,
              host: "localhost",
              workspace: {
                cwd: "D:\\projects\\a-very-long-workspace-name",
                projectName: "a-very-long-workspace-name",
              },
              activity: { startedAt: null, lastActivityAt: null },
              focusTarget: { kind: "process", pid: 42 },
            },
          ],
        },
      ],
    });

    const { container } = render(<AgentSessions />);

    expect(await screen.findByTitle("a-very-long-workspace-name")).toHaveClass(
      "agent-sessions__workspace",
    );
    expect(container.querySelector(".agent-sessions__list")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ActionRefresh" })).toHaveClass(
      "agent-sessions__refresh",
    );
  });
});
