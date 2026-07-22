import { useLocale } from "../../hooks/useLocale";
import { formatPaceEta } from "../../lib/usageDisplay";
import { paceCategory } from "../../surfaces/tray/paceCategory";
import { paceStageKey, type PaceEntry } from "./presentation";

interface PaceSectionProps {
  entries: PaceEntry[];
}

const PaceWindow = ({ entry }: { entry: PaceEntry }) => {
  const { t } = useLocale();
  const { pace } = entry;
  const category = paceCategory(pace.stage);

  return (
    <div className="menu-card__pace-window" data-pace-window={entry.id}>
      <div className="menu-card__pace-header">
        <span className="menu-card__group-title">
          {entry.label} {t("DetailPaceTitle")}
        </span>
        <span className="menu-card__pace-label" data-pace={category}>
          {t(paceStageKey(pace.stage))} ({pace.deltaPercent >= 0 ? "+" : ""}
          {pace.deltaPercent.toFixed(1)}%)
        </span>
      </div>
      <div className="menu-card__pace-bars">
        <div className="menu-card__pace-track" title={t("PanelExpected")}>
          <div
            className="menu-card__pace-fill menu-card__pace-fill--expected"
            style={{ width: `${pace.expectedUsedPercent.toFixed(1)}%` }}
          />
        </div>
        <div className="menu-card__pace-track" title={t("PanelActual")}>
          <div
            className="menu-card__pace-fill"
            data-pace={category}
            style={{ width: `${pace.actualUsedPercent.toFixed(1)}%` }}
          />
        </div>
      </div>
      {pace.etaSeconds != null && !pace.willLastToReset && (
        <div className="menu-card__pace-eta">
          ⚠{" "}
          {t("DetailPaceRunsOutIn")} {formatPaceEta(pace.etaSeconds)}
        </div>
      )}
      {pace.willLastToReset && (
        <div className="menu-card__pace-ok">
          ✓ {t("DetailPaceWillLastToReset")}
        </div>
      )}
    </div>
  );
};

const PaceSection = ({ entries }: PaceSectionProps) => (
  <section className="menu-card__group menu-card__pace">
    {entries.map((entry) => (
      <PaceWindow entry={entry} key={entry.id} />
    ))}
  </section>
);

export default PaceSection;
