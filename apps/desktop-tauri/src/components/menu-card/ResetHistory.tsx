import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import type { LocaleKey } from "../../i18n/keys";
import {
  getCodexResetHistory,
  getProofState,
  openExternalUrl,
} from "../../lib/tauri";
import type {
  CodexBankedResetHistoryEntry,
  CodexResetHistorySnapshot,
  Language,
} from "../../types/bridge";

const COUNTDOWN_TICK_MS = 60_000;
const LANGUAGE_TAGS: Record<Language, string> = {
  english: "en-US",
  chinese: "zh-CN",
  chinesetraditional: "zh-TW",
  japanese: "ja-JP",
  korean: "ko-KR",
  spanish: "es-MX",
};

type Translate = (key: LocaleKey) => string;

function interpolate(template: string, ...values: Array<string | number>): string {
  let result = template;
  for (const value of values) {
    result = result.replace("{}", String(value));
  }
  return result;
}

function absoluteDate(value: string, language: Language): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "—";
  return new Intl.DateTimeFormat(LANGUAGE_TAGS[language], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function bankedStatusText(
  entry: CodexBankedResetHistoryEntry,
  now: number,
  language: Language,
  t: Translate,
): string {
  if (entry.status.toLowerCase() === "redeemed") {
    return entry.redeemedAt
      ? interpolate(
          t("ResetHistoryRedeemedOn"),
          absoluteDate(entry.redeemedAt, language),
        )
      : t("ResetHistoryRedeemed");
  }
  if (entry.status.toLowerCase() === "expired") {
    return t("ResetHistoryExpired");
  }
  if (entry.status.toLowerCase() === "available") {
    const expiresAt = entry.expiresAt ? Date.parse(entry.expiresAt) : Number.NaN;
    if (Number.isFinite(expiresAt) && expiresAt > now) {
      const remainingHours = Math.max(
        0,
        Math.floor((expiresAt - now) / (60 * 60 * 1000)),
      );
      const days = Math.floor(remainingHours / 24);
      const hours = remainingHours % 24;
      return `${t("ResetHistoryAvailable")} · ${interpolate(
        t("ResetHistoryExpiresIn"),
        days,
        hours,
      )}`;
    }
    return t("ResetHistoryAvailable");
  }
  return entry.status;
}

export default function ResetHistory() {
  const { t, language } = useLocale();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] =
    useState<CodexResetHistorySnapshot | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const requestId = useRef(0);

  const load = () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(false);
    void getCodexResetHistory()
      .then((result) => {
        if (requestId.current === currentRequest) {
          setSnapshot(result);
        }
      })
      .catch(() => {
        if (requestId.current === currentRequest) {
          setError(true);
        }
      })
      .finally(() => {
        if (requestId.current === currentRequest) {
          setLoading(false);
        }
      });
  };

  const toggle = () => {
    if (!open) {
      setNow(Date.now());
      load();
    }
    setOpen(!open);
  };

  useEffect(() => {
    let active = true;
    void getProofState()
      .then((proofState) => {
        if (!active || !proofState.resetHistoryOpen) return;
        setNow(Date.now());
        setOpen(true);
        load();
      })
      .catch(() => {
        // The proof command is intentionally unavailable in ordinary runs.
      });
    return () => {
      active = false;
      requestId.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const countdownTimer = window.setInterval(
      () => setNow(Date.now()),
      COUNTDOWN_TICK_MS,
    );
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.metaKey
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(".codex-reset-history__trigger") ||
        target.closest(".codex-reset-history__panel")
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.clearInterval(countdownTimer);
      window.removeEventListener("keydown", closeOnEscape, true);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  const openAnnouncement = (url: string) => {
    setError(false);
    void openExternalUrl(url).catch(() => setError(true));
  };

  return (
    <div className="codex-reset-history">
      <button
        type="button"
        className="codex-reset-history__trigger"
        aria-expanded={open}
        aria-controls="codex-reset-history-panel"
        onClick={toggle}
      >
        <span aria-hidden>↺</span>
        <span>{t("ResetHistoryButton")}</span>
      </button>
      {open && (
        <section
          id="codex-reset-history-panel"
          className="codex-reset-history__panel"
          aria-label={t("ResetHistoryHeading")}
        >
          <header className="codex-reset-history__header">
            <div>
              <strong>{t("ResetHistoryHeading")}</strong>
              <span>{t("ResetHistoryDescription")}</span>
            </div>
            <button type="button" onClick={load} disabled={loading}>
              {loading
                ? t("ResetHistoryLoading")
                : t("ResetHistoryRefresh")}
            </button>
          </header>
          <div className="codex-reset-history__list">
            {loading && snapshot === null ? (
              <div className="codex-reset-history__empty">
                {t("ResetHistoryLoading")}
              </div>
            ) : snapshot === null || snapshot.entries.length === 0 ? (
              <div className="codex-reset-history__empty">
                {error
                  ? t("ResetHistoryLoadFailed")
                  : t("ResetHistoryEmpty")}
              </div>
            ) : (
              snapshot.entries.map((entry) =>
                entry.kind === "banked" ? (
                  <article
                    className="codex-reset-history__item"
                    key={`banked-${entry.id}`}
                  >
                    <span className="codex-reset-history__meta">
                      <time dateTime={entry.grantedAt}>
                        {absoluteDate(entry.grantedAt, language)}
                      </time>
                      <span className="codex-reset-history__tag">
                        {t("ResetHistoryBanked")}
                      </span>
                    </span>
                    <strong>{entry.title}</strong>
                    <span className="codex-reset-history__detail">
                      {entry.grantor && <span>{entry.grantor}</span>}
                      {entry.grantor && <span aria-hidden>·</span>}
                      <span>{bankedStatusText(entry, now, language, t)}</span>
                    </span>
                  </article>
                ) : (
                  <button
                    type="button"
                    className="codex-reset-history__item codex-reset-history__item--link"
                    key={`announced-${entry.postId}`}
                    onClick={() => openAnnouncement(entry.url)}
                    title={interpolate(
                      t("ResetHistoryOpenAnnouncement"),
                      entry.url,
                    )}
                  >
                    <span className="codex-reset-history__meta">
                      <time dateTime={entry.postDate}>
                        {absoluteDate(entry.postDate, language)}
                      </time>
                      <span className="codex-reset-history__tag codex-reset-history__tag--announced">
                        {t("ResetHistoryNonBanked")}
                      </span>
                    </span>
                    <strong>@{entry.handle}</strong>
                    <span className="codex-reset-history__snippet">
                      {entry.snippet}
                    </span>
                  </button>
                ),
              )
            )}
          </div>
          {(snapshot?.stale || error) && (
            <footer className="codex-reset-history__status">
              {error
                ? t("ResetHistoryLoadFailed")
                : t("ResetHistoryStale")}
            </footer>
          )}
        </section>
      )}
    </div>
  );
}
