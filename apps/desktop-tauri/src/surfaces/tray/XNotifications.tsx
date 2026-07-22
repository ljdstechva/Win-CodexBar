import { useEffect, useState } from "react";
import notificationBellIcon from "../../assets/fluent-alert-20-regular.svg";
import { useLocale } from "../../hooks/useLocale";
import type { LocaleKey } from "../../i18n/keys";
import type {
  Language,
  XNotificationSnapshot,
  XPostKind,
} from "../../types/bridge";

const RELATIVE_TIME_TICK_MS = 45_000;
const DELAYED_UPDATE_THRESHOLD_MS = 10 * 60 * 1000;
const LANGUAGE_TAGS: Record<Language, string> = {
  english: "en-US",
  chinese: "zh-CN",
  chinesetraditional: "zh-TW",
  japanese: "ja-JP",
  korean: "ko-KR",
  spanish: "es-MX",
};

type Translate = (key: LocaleKey) => string;

function interpolate(template: string, value: string | number): string {
  return template.replace("{}", String(value));
}

function kindLabel(kind: XPostKind, t: Translate): string {
  if (kind === "reply") return t("XNotificationsReply");
  if (kind === "repost") return t("XNotificationsRepost");
  return t("XNotificationsPost");
}

function relativeTime(value: string, now: number, language: Language): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.round((timestamp - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(LANGUAGE_TAGS[language], {
    numeric: "auto",
  });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function updatesMayBeDelayed(snapshot: XNotificationSnapshot): boolean {
  if (snapshot.lastCheckedAt === null) return false;
  const checkedAt = new Date(snapshot.lastCheckedAt).getTime();
  if (!Number.isFinite(checkedAt)) return false;
  if (snapshot.lastSuccessAt === null) return true;
  const successAt = new Date(snapshot.lastSuccessAt).getTime();
  return (
    Number.isFinite(successAt) &&
    checkedAt - successAt >= DELAYED_UPDATE_THRESHOLD_MS
  );
}

export function XNotificationButton({
  snapshot,
  panelOpen,
  onToggle,
}: {
  snapshot: XNotificationSnapshot;
  panelOpen: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  const label =
    snapshot.unreadCount > 0
      ? interpolate(t("XNotificationsUnreadLabel"), snapshot.unreadCount)
      : t("XNotificationsLabel");

  return (
    <button
      type="button"
      className={`menu-surface__btn tray-x-notifications__button${panelOpen ? " tray-x-notifications__button--open" : ""}`}
      aria-label={label}
      aria-expanded={panelOpen}
      aria-controls="tray-x-notifications-panel"
      onClick={onToggle}
      title={t("XNotificationsLabel")}
    >
      <img src={notificationBellIcon} alt="" aria-hidden />
      {snapshot.unreadCount > 0 && (
        <span className="tray-x-notifications__badge" aria-hidden>
          {snapshot.unreadCount > 99 ? "99+" : snapshot.unreadCount}
        </span>
      )}
    </button>
  );
}

export function XNotificationPanel({
  snapshot,
  refreshing,
  onRefresh,
  onOpenItem,
  onMarkAllRead,
}: {
  snapshot: XNotificationSnapshot;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenItem: (id: string) => void;
  onMarkAllRead: () => void;
}) {
  const { t, language } = useLocale();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), RELATIVE_TIME_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const checkedText = snapshot.lastCheckedAt
    ? interpolate(
        t("XNotificationsChecked"),
        relativeTime(snapshot.lastCheckedAt, now, language),
      )
    : t("XNotificationsNotChecked");
  const delayed = updatesMayBeDelayed(snapshot);

  return (
    <section
      id="tray-x-notifications-panel"
      className="tray-x-notifications__panel"
      aria-label={t("XNotificationsLabel")}
    >
      <header className="tray-x-notifications__header">
        <div className="tray-x-notifications__heading">
          <strong>{t("XNotificationsHeading")}</strong>
          <span>
            {snapshot.watchedHandles.map((handle) => `@${handle}`).join(" · ")}
          </span>
        </div>
        <div className="tray-x-notifications__actions">
          <button type="button" onClick={onRefresh} disabled={refreshing}>
            {refreshing
              ? t("XNotificationsChecking")
              : t("XNotificationsCheckNow")}
          </button>
          {snapshot.unreadCount > 0 && (
            <button type="button" onClick={onMarkAllRead}>
              {t("XNotificationsMarkAllRead")}
            </button>
          )}
        </div>
      </header>
      <div className="tray-x-notifications__list">
        {snapshot.items.length === 0 ? (
          <div className="tray-x-notifications__empty">
            {snapshot.lastError
              ? t("XNotificationsCheckFailed")
              : t("XNotificationsEmpty")}
          </div>
        ) : (
          snapshot.items.map((item) => (
            <button
              className="tray-x-notifications__item"
              type="button"
              key={item.id}
              onClick={() => onOpenItem(item.id)}
              title={interpolate(t("XNotificationsOpenItem"), item.url)}
            >
              <span className="tray-x-notifications__meta">
                <strong>{item.displayName}</strong>
                <span>@{item.handle}</span>
                <span aria-hidden>·</span>
                <time dateTime={item.createdAt}>
                  {relativeTime(item.createdAt, now, language)}
                </time>
              </span>
              <span className="tray-x-notifications__kind">
                {kindLabel(item.kind, t)}
              </span>
              <span className="tray-x-notifications__text">{item.text}</span>
            </button>
          ))
        )}
      </div>
      <footer className="tray-x-notifications__status">
        <span>{checkedText}</span>
        <span className="tray-x-notifications__status-alerts">
          {snapshot.lastError && (
            <span
              className="tray-x-notifications__warning"
              title={snapshot.lastError}
              aria-label={t("XNotificationsWarning")}
            >
              ⚠
            </span>
          )}
          {delayed && <span>{t("XNotificationsDelayed")}</span>}
        </span>
      </footer>
    </section>
  );
}
