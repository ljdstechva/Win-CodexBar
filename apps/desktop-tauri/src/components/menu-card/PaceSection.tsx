import { useEffect, useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import { computeLivePace, formatPaceDuration } from "../../lib/paceRate";
import { paceCategory } from "../../surfaces/tray/paceCategory";
import {
  describeLivePace,
  paceStageKey,
  type PaceEntry,
} from "./presentation";

/** Pace is recomputed locally every minute so it stays live between refreshes. */
export const PACE_TICK_MS = 60_000;

interface PaceSectionProps {
  entries: PaceEntry[];
}

const useMinuteClock = (): Date => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), PACE_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
};

const PaceWindow = ({ entry, now }: { entry: PaceEntry; now: Date }) => {
  const { t } = useLocale();
  const live = entry.snap
    ? computeLivePace(entry.snap, now, entry.defaultWindowMinutes)
    : null;
  // Fall back to the backend snapshot when the window lacks usable timing.
  const pace = live ?? entry.pace;
  const category = paceCategory(pace.stage);
  const advice = live ? describeLivePace(live, t) : null;

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
          {t("DetailPaceRunsOutIn")} {formatPaceDuration(pace.etaSeconds)}
        </div>
      )}
      {pace.willLastToReset && (
        <div className="menu-card__pace-ok">
          ✓ {t("DetailPaceWillLastToReset")}
        </div>
      )}
      {advice && (
        <>
          <dl className="menu-card__pace-rates">
            <div className="menu-card__pace-rate" title={advice.rateHint}>
              <dt>{t("DetailPaceYourRate")}</dt>
              <dd data-pace-tone={advice.tone}>{advice.rateText}</dd>
            </div>
            <div className="menu-card__pace-rate" title={advice.safeRateHint}>
              <dt>{t("DetailPaceSafeRate")}</dt>
              <dd>≤ {advice.safeRateText}</dd>
            </div>
          </dl>
          <p
            className="menu-card__pace-advice"
            data-pace-verdict={advice.verdict}
          >
            <strong data-pace-tone={advice.tone}>{advice.lead}</strong>{" "}
            {advice.message}
          </p>
        </>
      )}
    </div>
  );
};

const PaceSection = ({ entries }: PaceSectionProps) => {
  const now = useMinuteClock();
  return (
    <section className="menu-card__group menu-card__pace">
      {entries.map((entry) => (
        <PaceWindow entry={entry} key={entry.id} now={now} />
      ))}
    </section>
  );
};

export default PaceSection;
