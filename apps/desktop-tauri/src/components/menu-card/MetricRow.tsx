import type { RateWindowSnapshot } from "../../types/bridge";
import { useLocale } from "../../hooks/useLocale";
import { useFormattedResetTime } from "../../hooks/useFormattedResetTime";
import PaceDetailsChart from "../PaceDetailsChart";
import {
  formatReserveDescription,
  getMetricPaceView,
  levelOf,
} from "./presentation";

interface MetricRowProps {
  title: string;
  snap: RateWindowSnapshot;
  exhaustedLabel: string;
  resetTimeRelative: boolean;
  showResetWhenExhausted: boolean;
  showAsUsed: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}

const formatBudget = (value: number): string =>
  value < 10
    ? value.toFixed(1).replace(/\.0$/, "")
    : Math.round(value).toString();

const MetricRow = ({
  title,
  snap,
  exhaustedLabel,
  resetTimeRelative,
  showResetWhenExhausted,
  showAsUsed,
  expanded,
  onToggleExpanded,
}: MetricRowProps) => {
  const { t } = useLocale();
  const isInformational = snap.isInformational === true;
  const usedPercent = Number.isFinite(snap.usedPercent)
    ? Math.max(0, snap.usedPercent)
    : 0;
  const remainingPercent = Number.isFinite(snap.remainingPercent)
    ? Math.max(0, Math.min(100, snap.remainingPercent))
    : Math.max(0, 100 - usedPercent);
  const barPercent = showAsUsed
    ? Math.min(100, usedPercent)
    : Math.min(100, remainingPercent);
  const displayPercent = showAsUsed ? usedPercent : remainingPercent;
  const displayLabel = showAsUsed
    ? t("PanelUsedSuffix")
    : t("PanelLeftSuffix");
  const resetText = useFormattedResetTime(
    snap.resetsAt,
    snap.resetDescription,
    resetTimeRelative,
  );
  const resetTarget = snap.resetsAt ? Date.parse(snap.resetsAt) : Number.NaN;
  const replacesPercent =
    showResetWhenExhausted &&
    snap.isExhausted &&
    Number.isFinite(resetTarget) &&
    resetTarget > Date.now() &&
    resetText !== null;
  const paceView = getMetricPaceView(snap);
  const reserveDescription = formatReserveDescription(snap, t);

  return (
    <div className="menu-metric">
      <span className="menu-metric__title">{title}</span>
      {!isInformational && (
        <div className="menu-metric__bar">
          <div
            className="menu-metric__bar-fill"
            data-level={levelOf(remainingPercent, snap.isExhausted)}
            style={{ width: `${barPercent}%` }}
          />
        </div>
      )}
      <div className="menu-metric__row">
        <span className="menu-metric__pct">
          {isInformational
            ? resetText ?? "—"
            : replacesPercent
              ? resetText
              : `${Math.round(displayPercent)}% ${displayLabel}`}
        </span>
        {!isInformational && resetText && !replacesPercent && (
          <span className="menu-metric__reset">{resetText}</span>
        )}
      </div>
      {!isInformational && snap.isExhausted && (
        <div className="menu-metric__exhausted">{exhaustedLabel}</div>
      )}
      {!isInformational && paceView.kind === "budget" && (
        <div className="menu-metric__budget">
          <button
            type="button"
            className="menu-metric__budget-header"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
          >
            <span>{t("PanelOnPaceBudget")}</span>
            {reserveDescription && <span>{reserveDescription}</span>}
          </button>
          <div className="menu-metric__budget-pills">
            {[
              [t("PanelNow"), paceView.budget.now],
              [t("PanelOneHour"), paceView.budget.nextHour],
              [t("PanelFiveHours"), paceView.budget.nextFiveHours],
              [t("PanelTodayBudget"), paceView.budget.today],
            ].map(([label, value]) => (
              <span className="menu-metric__budget-pill" key={String(label)}>
                {label} {formatBudget(Number(value))}%
              </span>
            ))}
          </div>
          {expanded && <PaceDetailsChart snap={snap} t={t} />}
        </div>
      )}
      {!isInformational && paceView.kind === "reserve" && (
        <div className="menu-metric__row menu-metric__reserve">
          <span className="menu-metric__pct">
            {Math.round(paceView.percent)}% {t("PanelReserveSuffix")}
          </span>
          {reserveDescription && (
            <span className="menu-metric__reset">{reserveDescription}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default MetricRow;
