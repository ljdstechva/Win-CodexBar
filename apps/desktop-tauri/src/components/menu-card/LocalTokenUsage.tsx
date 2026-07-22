import type { ProviderLocalUsageSummary } from "../../types/bridge";
import { useLocale } from "../../hooks/useLocale";
import { formatCompactCount } from "./presentation";

interface LocalTokenUsageProps {
  summary: ProviderLocalUsageSummary;
}

const LocalTokenUsage = ({ summary }: LocalTokenUsageProps) => {
  const { t } = useLocale();
  return (
    <section className="menu-card__group menu-card__local-usage">
      <div className="menu-card__local-grid">
        <div>
          <span className="menu-card__local-label">
            {t("PanelThirtyDayTokens")}
          </span>
          <strong>{formatCompactCount(summary.thirtyDayTokens)}</strong>
        </div>
        <div>
          <span className="menu-card__local-label">
            {t("PanelLatestTokens")}
          </span>
          <strong>{formatCompactCount(summary.latestTokens)}</strong>
        </div>
      </div>
    </section>
  );
};

export default LocalTokenUsage;
