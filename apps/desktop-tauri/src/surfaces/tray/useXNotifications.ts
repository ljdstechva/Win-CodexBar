import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getXNotifications,
  markAllXNotificationsRead,
  openXNotification,
  refreshXNotifications,
} from "../../lib/tauri";
import type { XNotificationSnapshot } from "../../types/bridge";

export const X_NOTIFICATIONS_CHANGED_EVENT = "x-notifications-changed";
const X_NOTIFICATION_STALE_AFTER_MS = 5 * 60 * 1000;
const X_NOTIFICATION_COMMAND_ERRORS = {
  load: "X notifications could not be loaded.",
  subscribe: "X notification updates could not be subscribed.",
  refresh: "X notifications could not be refreshed.",
  open: "This X post could not be opened.",
  markAllRead: "X notifications could not be marked read.",
} as const;

const EMPTY_SNAPSHOT: XNotificationSnapshot = {
  unreadCount: 0,
  items: [],
  watchedHandles: ["thsottiaux", "OpenAI", "sama"],
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastError: null,
};

export function isXNotificationSnapshotStale(
  lastCheckedAt: string | null,
  now = Date.now(),
): boolean {
  if (lastCheckedAt === null) return true;
  const checkedAt = new Date(lastCheckedAt).getTime();
  return !Number.isFinite(checkedAt) || now - checkedAt > X_NOTIFICATION_STALE_AFTER_MS;
}

function withCommandError(
  snapshot: XNotificationSnapshot,
  message: string,
): XNotificationSnapshot {
  return { ...snapshot, lastError: message };
}

export function useXNotifications(panelOpen: boolean) {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const refreshingRef = useRef(false);
  const checkedOnMountRef = useRef(false);
  const previousPanelOpenRef = useRef(panelOpen);

  useEffect(() => {
    let cancelled = false;
    void getXNotifications()
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot((current) =>
            withCommandError(current, X_NOTIFICATION_COMMAND_ERRORS.load),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    const unlisten = listen<XNotificationSnapshot>(
      X_NOTIFICATIONS_CHANGED_EVENT,
      (event) => {
        if (!cancelled) setSnapshot(event.payload);
      },
    ).catch(() => {
      if (!cancelled) {
        setSnapshot((current) =>
          withCommandError(current, X_NOTIFICATION_COMMAND_ERRORS.subscribe),
        );
      }
      return () => {};
    });
    return () => {
      cancelled = true;
      void unlisten.then((dispose) => dispose()).catch(() => {});
    };
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      setSnapshot(await refreshXNotifications());
    } catch {
      setSnapshot((current) =>
        withCommandError(current, X_NOTIFICATION_COMMAND_ERRORS.refresh),
      );
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!loaded) {
      previousPanelOpenRef.current = panelOpen;
      return;
    }

    const opened = panelOpen && !previousPanelOpenRef.current;
    previousPanelOpenRef.current = panelOpen;
    const shouldCheck = !checkedOnMountRef.current || opened;
    checkedOnMountRef.current = true;
    if (shouldCheck && isXNotificationSnapshotStale(snapshot.lastCheckedAt)) {
      void refresh();
    }
  }, [loaded, panelOpen, refresh, snapshot.lastCheckedAt]);

  const openItem = useCallback(async (id: string): Promise<boolean> => {
    try {
      setSnapshot(await openXNotification(id));
      return true;
    } catch {
      setSnapshot((current) =>
        withCommandError(current, X_NOTIFICATION_COMMAND_ERRORS.open),
      );
      return false;
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      setSnapshot(await markAllXNotificationsRead());
    } catch {
      setSnapshot((current) =>
        withCommandError(current, X_NOTIFICATION_COMMAND_ERRORS.markAllRead),
      );
    }
  }, []);

  return { snapshot, refreshing, refresh, openItem, markAllRead };
}
