import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SettingsSnapshot } from "../types/bridge";
import { resizeFloatBar } from "./api";
import { CLICK_THROUGH_HOVER_OPACITY } from "./useFloatBarSettings";

interface FloatBarWindowOptions {
  settings: SettingsSnapshot;
  clickThroughHovered: boolean;
  visibleLength: number;
  visibleMetricValuesKey: string;
  orientation: string;
  style: string;
  scale: number;
  showResetInline: boolean;
}

// Horizontal max-content layout can land fractionally outside the WebView
// viewport after Windows DPI scaling. Keep a small symmetric native guard so
// rounded pill borders and the drag handle remain fully capturable/clickable.
const HORIZONTAL_CLIP_GUARD = 20;

export function measureFloatBarContent(
  element: HTMLElement,
  padding = 8,
): { w: number; h: number } {
  const rect = element.getBoundingClientRect();
  const body = element.querySelector<HTMLElement>(".floatbar__body");
  const vertical = body?.classList.contains("floatbar__body--vertical") ?? false;
  const children = body
    ? Array.from(body.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      )
    : [];
  let intrinsicWidth = 0;
  let intrinsicHeight = 0;

  if (body && children.length > 0) {
    const style = window.getComputedStyle(body);
    const gapValue = vertical ? style.rowGap : style.columnGap;
    const gap = Number.parseFloat(gapValue || style.gap) || 0;
    const widths = children.map((child) => {
      const childRect = child.getBoundingClientRect();
      return Math.max(childRect.width, child.scrollWidth);
    });
    const heights = children.map((child) => {
      const childRect = child.getBoundingClientRect();
      return Math.max(childRect.height, child.scrollHeight);
    });
    const totalGap = gap * Math.max(0, children.length - 1);
    intrinsicWidth = vertical
      ? Math.max(...widths)
      : widths.reduce((sum, width) => sum + width, 0) + totalGap;
    intrinsicHeight = vertical
      ? heights.reduce((sum, height) => sum + height, 0) + totalGap
      : Math.max(...heights);
  }

  return {
    w: Math.ceil(
      Math.max(rect.width, element.scrollWidth, intrinsicWidth) +
        padding +
        (body && !vertical ? HORIZONTAL_CLIP_GUARD : 0),
    ),
    h: Math.ceil(
      Math.max(rect.height, element.scrollHeight, intrinsicHeight) + padding,
    ),
  };
}

/** Own body transparency, native sizing, drag, and opacity behavior. */
export function useFloatBarWindow({
  settings,
  clickThroughHovered,
  visibleLength,
  visibleMetricValuesKey,
  orientation,
  style,
  scale,
  showResetInline,
}: FloatBarWindowOptions) {
  const startDrag = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a, [data-no-drag]")) return;
    void getCurrentWindow().startDragging().catch(() => {});
  }, []);

  // The floatbar window is transparent around the individually rendered pills.
  useEffect(() => {
    document.body.classList.add("floatbar-window");
    return () => {
      document.body.classList.remove("floatbar-window");
    };
  }, []);

  const lastResizeRef = useRef<{ w: number; h: number } | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const resizeToContent = useCallback(() => {
    const el = document.querySelector<HTMLElement>(".floatbar");
    if (!el) return;
    if (resizeRafRef.current !== null) {
      cancelAnimationFrame(resizeRafRef.current);
    }
    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = null;
      // `getBoundingClientRect()` is viewport-constrained after the native
      // window has already been sized. `scrollWidth`/`scrollHeight` retain the
      // intrinsic overflow, including newly-added account/countdown pills.
      const { w, h } = measureFloatBarContent(el);
      const last = lastResizeRef.current;
      if (last && Math.abs(last.w - w) <= 1 && Math.abs(last.h - h) <= 1) {
        return;
      }
      lastResizeRef.current = { w, h };
      void resizeFloatBar(w, h).catch(() => {});
    });
  }, []);

  useEffect(() => {
    resizeToContent();
  }, [
    resizeToContent,
    visibleLength,
    visibleMetricValuesKey,
    orientation,
    style,
    scale,
    showResetInline,
    settings.floatBarClickThrough,
    settings.resetTimeRelative,
  ]);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".floatbar");
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resizeToContent);
    observer.observe(el);
    return () => observer.disconnect();
  }, [resizeToContent]);

  useEffect(
    () => () => {
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
    },
    [],
  );

  const opacityFraction = Math.max(0.3, Math.min(1, settings.floatBarOpacity / 100));
  const renderedOpacity =
    settings.floatBarClickThrough && clickThroughHovered
      ? Math.min(opacityFraction, CLICK_THROUGH_HOVER_OPACITY)
      : opacityFraction;

  return { startDrag, renderedOpacity };
}
