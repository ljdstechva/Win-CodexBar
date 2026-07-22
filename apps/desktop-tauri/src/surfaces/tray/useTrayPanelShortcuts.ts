import { useEffect } from "react";
import { dismissTrayPanel } from "../../lib/tauri";

interface TrayPanelShortcutActions {
  refresh: () => void;
  openSettings: () => void;
  quit: () => void;
  onEscape?: () => boolean;
}

export const useTrayPanelShortcuts = ({
  refresh,
  openSettings,
  quit,
  onEscape,
}: TrayPanelShortcutActions): void => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        if (onEscape?.()) return;
        void dismissTrayPanel().catch(() => {});
        return;
      }
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
        return;
      }

      const actions: Record<string, () => void> = {
        r: refresh,
        ",": openSettings,
        q: quit,
      };
      const action = actions[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      action();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEscape, openSettings, quit, refresh]);
};
