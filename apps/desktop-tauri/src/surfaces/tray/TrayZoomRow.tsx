import type { CSSProperties } from "react";
import { useLocale } from "../../hooks/useLocale";
import {
  TRAY_SCALE_MAX,
  TRAY_SCALE_MIN,
  TRAY_SCALE_STEP,
} from "./useTrayScale";

interface TrayZoomRowProps {
  value: number;
  fillPercent: number;
  onChange: (value: number) => void;
}

const TrayZoomRow = ({ value, fillPercent, onChange }: TrayZoomRowProps) => {
  const { t } = useLocale();
  return (
    <div className="menu-surface__footer-row menu-surface__footer-zoom">
      <span>{t("PanelZoom")}</span>
      <input
        type="range"
        className="menu-surface__footer-zoom-slider"
        min={TRAY_SCALE_MIN}
        max={TRAY_SCALE_MAX}
        step={TRAY_SCALE_STEP}
        value={value}
        aria-label={t("PanelZoom")}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--zoom-fill": `${fillPercent}%` } as CSSProperties}
      />
      <span className="menu-surface__footer-zoom-value">{value}%</span>
    </div>
  );
};

export default TrayZoomRow;
