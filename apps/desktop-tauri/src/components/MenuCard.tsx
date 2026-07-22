import { useState } from "react";
import type { ProviderUsageSnapshot } from "../types/bridge";
import { useLocale } from "../hooks/useLocale";
import { formatRelativeUpdated } from "../lib/relativeTime";
import { SimpleBarChart, StackedBarChart } from "./MiniBarChart";
import CopyIconButton from "./menu-card/CopyIconButton";
import LocalTokenUsage from "./menu-card/LocalTokenUsage";
import MetricRow from "./menu-card/MetricRow";
import PaceSection from "./menu-card/PaceSection";
import WayfinderUsage from "./menu-card/WayfinderUsage";
import {
  buildMetricEntries,
  buildPaceEntries,
  displayPlanName,
  maskEmail,
  subscriptionCountdown,
} from "./menu-card/presentation";
import { useProviderCardData } from "./menu-card/useProviderCardData";

interface MenuCardProps {
  provider: ProviderUsageSnapshot;
  hideEmail: boolean;
  resetTimeRelative: boolean;
  showResetWhenExhausted?: boolean;
  showAsUsed?: boolean;
  compactMetrics?: boolean;
  isRefreshing?: boolean;
  onLayoutChange?: () => void;
}

const MenuCard = ({
  provider,
  hideEmail,
  resetTimeRelative,
  showResetWhenExhausted = false,
  showAsUsed = false,
  compactMetrics = false,
  isRefreshing = false,
  onLayoutChange,
}: MenuCardProps) => {
  const { t } = useLocale();
  const [expandedPaceWindow, setExpandedPaceWindow] = useState<string | null>(
    null,
  );
  const chartData = useProviderCardData({
    providerId: provider.providerId,
    accountEmail: provider.accountEmail,
    onLayoutChange,
  });
  const isWayfinder = provider.providerId === "wayfinder";
  const email = !isWayfinder && provider.accountEmail
    ? hideEmail
      ? maskEmail(provider.accountEmail)
      : provider.accountEmail
    : null;
  const planName = !isWayfinder
    ? displayPlanName(provider.planName, t("ProviderPlanClaudeAi"))
    : null;
  const now = new Date();
  const countdown = !isWayfinder
    ? subscriptionCountdown(provider.subscriptionEndsAt, now)
    : null;
  const subscriptionEndMs = provider.subscriptionEndsAt
    ? Date.parse(provider.subscriptionEndsAt)
    : Number.NaN;
  const planBadgeTitle = Number.isNaN(subscriptionEndMs)
    ? undefined
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(subscriptionEndMs));
  const planBadgeText =
    planName && countdown
      ? `${planName} · ${t("SubscriptionCountdownLeft").replace("{}", countdown)}`
      : planName;
  const metrics = buildMetricEntries(provider, t);
  const paceEntries = buildPaceEntries(provider, t);
  const visibleMetrics = compactMetrics ? metrics.slice(0, 2) : metrics;
  const hasCreditsHistory = (chartData?.creditsHistory.length ?? 0) > 0;
  const hasUsageBreakdown = (chartData?.usageBreakdown.length ?? 0) > 0;
  const hasCharts = hasCreditsHistory || hasUsageBreakdown;
  const localUsage = provider.error ? null : chartData?.localUsage ?? null;
  const hasMetrics = visibleMetrics.length > 0;
  const hasPace = paceEntries.length > 0;
  const wayfinderUsage = isWayfinder ? provider.wayfinderUsage : null;
  const hasDetails =
    !provider.error &&
    (hasMetrics || hasPace || hasCharts || localUsage != null || !!wayfinderUsage);
  const cardClassName = [
    "menu-card",
    provider.error ? "menu-card--error" : null,
    isRefreshing ? "menu-card--refreshing" : null,
    hasDetails ? "menu-card--with-details" : "menu-card--header-only",
  ]
    .filter(Boolean)
    .join(" ");

  const togglePaceWindow = (metricId: string) => {
    setExpandedPaceWindow((current) =>
      current === metricId ? null : metricId,
    );
    requestAnimationFrame(() => onLayoutChange?.());
  };

  return (
    <article className={cardClassName} aria-busy={isRefreshing}>
      <header className="menu-card__header">
        <div className="menu-card__title-row">
          <div className="menu-card__name-group">
            <span className="menu-card__name">{provider.displayName}</span>
            {!provider.error && email && (
              <span className="menu-card__email">{email}</span>
            )}
          </div>
        </div>
        {provider.error ? (
          <div className="menu-card__error-block">
            <div className="menu-card__error-text">{provider.error}</div>
            <CopyIconButton text={provider.error} />
          </div>
        ) : (
          <div className="menu-card__subtitle-row">
            <span className="menu-card__subtitle">
              {Number.isNaN(Date.parse(provider.updatedAt))
                ? provider.updatedAt
                : formatRelativeUpdated(Date.parse(provider.updatedAt), t)}
            </span>
            {planBadgeText && (
              <span className="menu-card__plan-badge" title={planBadgeTitle}>
                {planBadgeText}
              </span>
            )}
          </div>
        )}
      </header>

      {hasDetails && <div className="menu-card__divider" />}

      {hasDetails && (
        <div className="menu-card__content">
          {!provider.error && hasMetrics && (
            <section className="menu-card__group menu-card__metrics">
              {visibleMetrics.map((metric) => (
                <MetricRow
                  key={metric.id}
                  title={metric.label}
                  snap={metric.snap}
                  exhaustedLabel={t("DetailWindowExhausted")}
                  resetTimeRelative={resetTimeRelative}
                  showResetWhenExhausted={showResetWhenExhausted}
                  showAsUsed={showAsUsed}
                  expanded={expandedPaceWindow === metric.id}
                  onToggleExpanded={() => togglePaceWindow(metric.id)}
                />
              ))}
            </section>
          )}

          {localUsage && <LocalTokenUsage summary={localUsage} />}

          {wayfinderUsage && <WayfinderUsage usage={wayfinderUsage} />}

          {hasMetrics && hasPace && <div className="menu-card__divider" />}

          {hasPace && <PaceSection entries={paceEntries} />}

          {(hasMetrics || hasPace) && hasCharts && (
            <div className="menu-card__divider" />
          )}

          {hasCharts && (
            <section className="menu-card__group menu-card__charts">
              {hasCreditsHistory && (
                <SimpleBarChart
                  points={chartData!.creditsHistory}
                  label={t("DetailChartCredits")}
                  color="var(--provider-status-ok)"
                  formatValue={(value) => value.toFixed(1)}
                  t={t}
                />
              )}
              {hasUsageBreakdown && (
                <StackedBarChart
                  points={chartData!.usageBreakdown}
                  label={t("DetailChartUsageBreakdown")}
                  height={56}
                  t={t}
                />
              )}
            </section>
          )}
        </div>
      )}
    </article>
  );
};

export default MenuCard;
