import { useCallback, useEffect, useRef, useState } from "react";
import { updateSettings } from "../../lib/tauri";

export const TRAY_SCALE_MIN = 75;
export const TRAY_SCALE_MAX = 200;
export const TRAY_SCALE_STEP = 5;
const TRAY_SCALE_COMMIT_DEBOUNCE_MS = 250;

export const clampTrayScalePercent = (value: number): number =>
  Math.min(
    TRAY_SCALE_MAX,
    Math.max(TRAY_SCALE_MIN, Number.isFinite(value) ? value : 100),
  );

export const useTrayScale = (persistedPercent: number) => {
  const persisted = clampTrayScalePercent(persistedPercent);
  const [draft, setDraft] = useState(persisted);
  const commitTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (commitTimerRef.current === undefined) setDraft(persisted);
  }, [persisted]);

  useEffect(
    () => () => {
      if (commitTimerRef.current !== undefined) {
        window.clearTimeout(commitTimerRef.current);
      }
    },
    [],
  );

  const change = useCallback((value: number) => {
    const next = clampTrayScalePercent(value);
    setDraft(next);
    if (commitTimerRef.current !== undefined) {
      window.clearTimeout(commitTimerRef.current);
    }
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = undefined;
      void updateSettings({ trayScalePercent: next }).catch(() => {});
    }, TRAY_SCALE_COMMIT_DEBOUNCE_MS);
  }, []);

  return {
    draft,
    scale: draft / 100,
    fillPercent:
      ((draft - TRAY_SCALE_MIN) / (TRAY_SCALE_MAX - TRAY_SCALE_MIN)) * 100,
    change,
  };
};
