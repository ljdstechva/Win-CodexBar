import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getSettingsSnapshot, refreshProvidersIfStale } from "../lib/tauri";
import type { SettingsSnapshot } from "../types/bridge";
import {
  FLOAT_BAR_CONFIG_CHANGED_EVENT,
  isCursorOverFloatBar,
} from "./api";

export const CLICK_THROUGH_HOVER_OPACITY = 0.1;
export const CLICK_THROUGH_HOVER_POLL_MS = 100;

/** Own the detached window's settings subscription and passive cursor state. */
export function useFloatBarSettings(initial: SettingsSnapshot) {
  const [settings, setSettings] = useState<SettingsSnapshot>(initial);
  const [clickThroughHovered, setClickThroughHovered] = useState(false);

  // Keep usage fresh without opening or focusing another surface.
  useEffect(() => {
    const intervalMs = Math.max(60_000, settings.refreshIntervalSecs * 1000);
    const tick = () => {
      void refreshProvidersIfStale().catch(() => {});
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [settings.refreshIntervalSecs]);

  useEffect(() => {
    const unlisten = listen(FLOAT_BAR_CONFIG_CHANGED_EVENT, () => {
      void getSettingsSnapshot().then(setSettings).catch(() => {});
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // A WS_EX_TRANSPARENT window never receives CSS hover events. Poll the
  // global cursor through the native layer so click-through stays enabled
  // while the bar can still visually yield to content underneath it.
  useEffect(() => {
    if (!settings.floatBarClickThrough) {
      setClickThroughHovered(false);
      return;
    }

    let cancelled = false;
    let pending = false;
    const checkCursor = () => {
      if (pending) return;
      pending = true;
      void isCursorOverFloatBar()
        .then((hovered) => {
          if (!cancelled) setClickThroughHovered(hovered);
        })
        .catch(() => {
          if (!cancelled) setClickThroughHovered(false);
        })
        .finally(() => {
          pending = false;
        });
    };

    checkCursor();
    const id = setInterval(checkCursor, CLICK_THROUGH_HOVER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [settings.floatBarClickThrough]);

  return { settings, clickThroughHovered };
}
