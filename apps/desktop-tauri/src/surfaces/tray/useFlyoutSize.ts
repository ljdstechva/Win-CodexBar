import { useCallback, useEffect, useRef, useState } from "react";
import { flyoutStoredSize, setFlyoutSize } from "../../lib/tauri";

type FlyoutSize = [number, number] | null | undefined;

export const useFlyoutSize = () => {
  const [flyoutSize, setFlyoutSizeState] = useState<FlyoutSize>(undefined);
  const [autoFitKilled, setAutoFitKilled] = useState(false);
  const saveTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void flyoutStoredSize()
      .then((size) => {
        if (active) setFlyoutSizeState(size);
      })
      .catch(() => {
        if (active) setFlyoutSizeState(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
    },
    [],
  );

  const handleUserResize = useCallback((width: number, height: number) => {
    setAutoFitKilled(true);
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      setFlyoutSizeState([width, height]);
      void setFlyoutSize(width, height).catch(() => {});
    }, 300);
  }, []);

  const fixedSize = Array.isArray(flyoutSize) ? flyoutSize : null;
  return {
    fixedSize,
    autoFit: flyoutSize === null && !autoFitKilled,
    handleUserResize,
  };
};
