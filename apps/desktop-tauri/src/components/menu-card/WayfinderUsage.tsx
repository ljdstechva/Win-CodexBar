import type { ProviderUsageSnapshot } from "../../types/bridge";
import { useLocale } from "../../hooks/useLocale";
import { formatCompactCount } from "./presentation";

interface WayfinderUsageProps {
  usage: NonNullable<ProviderUsageSnapshot["wayfinderUsage"]>;
}

const WayfinderUsage = ({ usage }: WayfinderUsageProps) => {
  const { t } = useLocale();
  const formatAmount = (value: number) =>
    usage.priced ? `${value.toFixed(4)} ${usage.unit.toUpperCase()}` : "—";

  return (
    <section className="menu-card__group menu-card__wayfinder">
      <div className="menu-card__local-grid">
        <div>
          <span className="menu-card__local-label">
            {t("WayfinderGatewayStatus")}
          </span>
          <strong>{usage.gatewayStatus}</strong>
        </div>
        <div>
          <span className="menu-card__local-label">{t("WayfinderModels")}</span>
          <strong>{usage.modelCount}</strong>
        </div>
        <div>
          <span className="menu-card__local-label">
            {t("WayfinderRequests")}
          </span>
          <strong>{formatCompactCount(usage.requests)}</strong>
        </div>
        <div>
          <span className="menu-card__local-label">{t("WayfinderTokens")}</span>
          <strong>{formatCompactCount(usage.tokens)}</strong>
        </div>
      </div>
      <div className="menu-card__wayfinder-savings">
        {t("WayfinderSaved")}: {formatAmount(usage.saved)} (
        {usage.savedPercent.toFixed(1)}%)
      </div>
      {(usage.offline || usage.dryRun || usage.missingKeys.length > 0) && (
        <div className="menu-card__wayfinder-notes">
          {usage.offline && <span>{t("WayfinderOffline")}</span>}
          {usage.dryRun && <span>{t("WayfinderDryRun")}</span>}
          {usage.missingKeys.length > 0 && (
            <span>
              {t("WayfinderMissingKeys")}: {usage.missingKeys.join(", ")}
            </span>
          )}
        </div>
      )}
    </section>
  );
};

export default WayfinderUsage;
