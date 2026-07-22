import { useCallback, useEffect, useState } from "react";
import { focusAgentSession, listAgentSessions } from "../lib/tauri";
import type {
  AgentSession,
  AgentSessionDiscoveryResult,
} from "../types/bridge";
import { useLocale } from "../hooks/useLocale";

export default function AgentSessions() {
  const { t } = useLocale();
  const [result, setResult] = useState<AgentSessionDiscoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    void listAgentSessions()
      .then(setResult)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  useEffect(refresh, [refresh]);

  if (result?.status === "disabled") return null;
  const hosts = result?.status === "hosts" ? result.hosts : [];
  const sessions = hosts.flatMap((host) => host.sessions);
  const hostErrors = hosts.flatMap((host) =>
    host.error ? [`${host.host}: ${host.error}`] : [],
  );

  const focus = (session: AgentSession) => {
    void focusAgentSession(session).then((focusResult) => {
      if (focusResult.status !== "focused") setError(focusResult.message);
    });
  };

  return (
    <section className="agent-sessions" aria-label={t("AgentSessionsTitle")}>
      <div className="agent-sessions__header">
        <strong>{t("AgentSessionsTitle")}</strong>
        <button className="agent-sessions__refresh" type="button" onClick={refresh}>
          {t("ActionRefresh")}
        </button>
      </div>
      {!result && <p>{t("AgentSessionsLoading")}</p>}
      {result && sessions.length === 0 && (
        <p>{t("AgentSessionsEmpty")}</p>
      )}
      {sessions.length > 0 && (
        <div className="agent-sessions__list">
          {sessions.map((session) => {
            const workspace =
              session.workspace.projectName ?? session.workspace.cwd ?? session.host;
            return (
              <button
                type="button"
                className="agent-sessions__row"
                key={`${session.host}:${session.provider}:${session.id}`}
                onClick={() => focus(session)}
              >
                <span className="agent-sessions__provider">
                  {session.provider === "codex"
                    ? t("ProviderNameCodex")
                    : t("ProviderNameClaude")}
                </span>
                <span className="agent-sessions__workspace" title={workspace}>
                  {workspace}
                </span>
                <span className="agent-sessions__state">{session.state}</span>
              </button>
            );
          })}
        </div>
      )}
      {[...hostErrors, ...(error ? [error] : [])].map((message) => (
        <p className="agent-sessions__error" key={message}>{message}</p>
      ))}
    </section>
  );
}
