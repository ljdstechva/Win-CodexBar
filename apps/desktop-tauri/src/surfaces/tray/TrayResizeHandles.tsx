import { getCurrentWindow } from "@tauri-apps/api/window";
import { beginFlyoutGesture } from "../../lib/tauri";

const beginResize = async (
  direction: "North" | "West" | "NorthWest",
): Promise<void> => {
  await beginFlyoutGesture().catch(() => {});
  await getCurrentWindow().startResizeDragging(direction);
};

const TrayResizeHandles = () => (
  <>
    <div
      className="tray-resize tray-resize--top"
      aria-hidden
      onMouseDown={(event) => {
        event.preventDefault();
        void beginResize("North").catch((error) =>
          console.error("[tray-resize] startResizeDragging failed:", error),
        );
      }}
    />
    <div
      className="tray-resize tray-resize--left"
      aria-hidden
      onMouseDown={(event) => {
        event.preventDefault();
        void beginResize("West").catch((error) =>
          console.error("[tray-resize] startResizeDragging failed:", error),
        );
      }}
    />
    <div
      className="tray-resize tray-resize--topleft"
      aria-hidden
      onMouseDown={(event) => {
        event.preventDefault();
        void beginResize("NorthWest").catch((error) =>
          console.error("[tray-resize] startResizeDragging failed:", error),
        );
      }}
    />
  </>
);

export default TrayResizeHandles;
