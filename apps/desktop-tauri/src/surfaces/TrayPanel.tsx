import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { BootstrapState, ProviderUsageSnapshot } from "../types/bridge";
import {
  beginFlyoutGesture,
  endFlyoutGesture,
  getProofState,
  openSettingsWindow,
  quitApp as quitApplication,
  reorderProviders,
  setSurfaceMode,
} from "../lib/tauri";
import { useProviders } from "../hooks/useProviders";
import { useSettings } from "../hooks/useSettings";
import { useLocale } from "../hooks/useLocale";
import { useSurfaceTarget } from "../hooks/useSurfaceMode";
import { useTrayPanelLayout } from "../hooks/useTrayPanelLayout";
import MenuCard from "../components/MenuCard";
import MenuSurface, {
  MenuEmpty,
  type MenuFooterRow,
} from "../components/MenuSurface";
import ProviderGrid from "../components/ProviderGrid";
import AgentSessions from "../components/AgentSessions";
import TrayContextActions from "./tray/TrayContextActions";
import TrayResizeHandles from "./tray/TrayResizeHandles";
import TrayZoomRow from "./tray/TrayZoomRow";
import {
  XNotificationButton,
  XNotificationPanel,
} from "./tray/XNotifications";
import { useFlyoutSize } from "./tray/useFlyoutSize";
import { useTrayPanelShortcuts } from "./tray/useTrayPanelShortcuts";
import { useTrayProviderView } from "./tray/useTrayProviderView";
import { useTrayScale } from "./tray/useTrayScale";
import { useXNotifications } from "./tray/useXNotifications";

const TRAY_INITIAL_REFRESH_DELAY_MS = 250;

function initialNotificationPanelOpen(): boolean {
  return new URLSearchParams(window.location.search).get("xNotifications") === "open";
}

export default function TrayPanel({ state }: { state: BootstrapState }) {
  const { settings } = useSettings(state.settings);
  const {
    providers,
    isRefreshing,
    refreshingProviderIds,
    refresh,
    hasCachedData,
    hasLoadedCache,
  } = useProviders({
    initialRefreshDelayMs: TRAY_INITIAL_REFRESH_DELAY_MS,
    forceRefreshOnMount: settings.refreshAllProvidersOnMenuOpen,
  });
  const { t } = useLocale();
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(
    initialNotificationPanelOpen,
  );
  useEffect(() => {
    if (initialNotificationPanelOpen()) return;
    void getProofState()
      .then((proofState) => {
        if (proofState.xNotificationsOpen) setNotificationPanelOpen(true);
      })
      .catch(() => {});
  }, []);
  const {
    snapshot: xNotificationSnapshot,
    refreshing: xNotificationsRefreshing,
    refresh: refreshXNotifications,
    openItem: openXNotification,
    markAllRead: markAllXNotificationsRead,
  } = useXNotifications(notificationPanelOpen);
  const surfaceTarget = useSurfaceTarget("trayPanel");
  const trayScale = useTrayScale(settings.trayScalePercent);
  const traySurfaceStyle = {
    zoom: trayScale.scale,
    "--tray-zoom": trayScale.scale,
  } as CSSProperties;
  const initialProviderId =
    surfaceTarget?.kind === "provider" ? surfaceTarget.providerId : null;
  const providerView = useTrayProviderView({
    providers,
    catalog: state.providers,
    enabledProviderIds: settings.enabledProviders,
    providerOrder: settings.providerOrder,
    initialProviderId,
  });
  const { fixedSize, autoFit, handleUserResize } = useFlyoutSize();
  const layoutKey = useMemo(
    () =>
      [
        providerView.selectedProviderId ?? "overview",
        providerView.gridExpanded ? "expanded" : "collapsed",
        isRefreshing ? "refreshing" : "idle",
        providerView.expectsDenseOverview ? "dense" : "normal",
        hasLoadedCache ? "cache-ready" : "cache-pending",
        notificationPanelOpen ? "x-open" : "x-closed",
        `x-unread:${xNotificationSnapshot.unreadCount}`,
        providerView.visibleProviders
          .map((provider) => provider.providerId)
          .join(","),
        trayScale.draft,
      ].join("|"),
    [
      hasLoadedCache,
      isRefreshing,
      notificationPanelOpen,
      providerView.expectsDenseOverview,
      providerView.gridExpanded,
      providerView.selectedProviderId,
      providerView.visibleProviders,
      trayScale.draft,
      xNotificationSnapshot.unreadCount,
    ],
  );
  const useWideColumns =
    providerView.selectedProviderId === null &&
    fixedSize !== null &&
    fixedSize[0] >= 640;
  const wideColumns = useMemo(() => {
    const columns: ProviderUsageSnapshot[][] = [[], []];
    providerView.visibleProviders.forEach((provider, index) => {
      columns[index % 2].push(provider);
    });
    return columns;
  }, [providerView.visibleProviders]);
  const { layoutReady, requestLayout } = useTrayPanelLayout({
    canMeasure: hasLoadedCache || providerView.sorted.length > 0,
    denseOverview: providerView.expectsDenseOverview,
    detailMode: providerView.selectedProviderId !== null,
    layoutKey,
    autoFit,
    fixedSize,
    isOpen: true,
    minHeightFloor: notificationPanelOpen ? 480 : undefined,
    onUserResize: handleUserResize,
  });

  const openSettings = useCallback(() => {
    void openSettingsWindow("general").finally(() => {
      void getCurrentWindow().close();
    });
  }, []);
  const openPopOut = useCallback(() => {
    setSurfaceMode("popOut", { kind: "dashboard" });
  }, []);
  const openAbout = useCallback(() => {
    void openSettingsWindow("about").finally(() => {
      void getCurrentWindow().close();
    });
  }, []);
  const quitApp = useCallback(() => {
    void quitApplication();
  }, []);
  const handleNotificationEscape = useCallback(() => {
    if (!notificationPanelOpen) return false;
    setNotificationPanelOpen(false);
    return true;
  }, [notificationPanelOpen]);
  useTrayPanelShortcuts({
    refresh,
    openSettings,
    quit: quitApp,
    onEscape: handleNotificationEscape,
  });

  useEffect(() => {
    if (!notificationPanelOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(".tray-x-notifications__button") ||
        target.closest(".tray-x-notifications__panel")
      ) {
        return;
      }
      setNotificationPanelOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [notificationPanelOpen]);

  const handleOpenXNotification = useCallback(
    (id: string) => {
      void openXNotification(id).then((opened) => {
        if (opened) setNotificationPanelOpen(false);
      });
    },
    [openXNotification],
  );

  const headerActions = [
    { icon: "⧉", title: t("TooltipPopOut"), onClick: openPopOut },
  ];
  const xNotificationButton = (
    <XNotificationButton
      snapshot={xNotificationSnapshot}
      panelOpen={notificationPanelOpen}
      onToggle={() => setNotificationPanelOpen((open) => !open)}
    />
  );
  const xNotificationPanel = notificationPanelOpen ? (
    <XNotificationPanel
      snapshot={xNotificationSnapshot}
      refreshing={xNotificationsRefreshing}
      onRefresh={refreshXNotifications}
      onOpenItem={handleOpenXNotification}
      onMarkAllRead={markAllXNotificationsRead}
    />
  ) : null;
  const footerRows: MenuFooterRow[] = [
    { icon: "↻", label: t("ActionRefresh"), shortcut: "Ctrl+R", onClick: refresh },
    { icon: "⚙", label: t("MenuSettings"), shortcut: "Ctrl+,", onClick: openSettings },
    { icon: "ⓘ", label: t("MenuAbout"), onClick: openAbout },
    { icon: "⌧", label: t("MenuQuit"), shortcut: "Ctrl+Q", onClick: quitApp },
  ];
  const zoomRow = (
    <TrayZoomRow
      value={trayScale.draft}
      fillPercent={trayScale.fillPercent}
      onChange={trayScale.change}
    />
  );
  const handleReorder = useCallback((orderedIds: string[]) => {
    void reorderProviders(orderedIds).catch(() => {});
  }, []);
  const handleGestureStart = useCallback(() => {
    void beginFlyoutGesture().catch(() => {});
  }, []);
  const handleGestureEnd = useCallback(() => {
    void endFlyoutGesture().catch(() => {});
  }, []);
  const revealClassName = `tray-panel-reveal${layoutReady ? " tray-panel-reveal--ready" : ""}${providerView.expectsDenseOverview ? " tray-panel-reveal--dense" : ""}${fixedSize ? " tray-panel-reveal--usersized" : ""}`;
  const renderProviderCard = (provider: ProviderUsageSnapshot) => {
    const isSelected =
      providerView.selectedProviderId !== null &&
      provider.providerId === providerView.selectedProviderId;
    return (
      <div
        className={`menu-stack__item${isSelected ? " menu-stack__item--selected" : ""}`}
        id={`card-${provider.providerId}`}
        key={provider.providerId}
      >
        <MenuCard
          provider={provider}
          isRefreshing={refreshingProviderIds.has(provider.providerId)}
          hideEmail={settings.hidePersonalInfo}
          resetTimeRelative={settings.resetTimeRelative}
          showResetWhenExhausted={settings.showResetWhenExhausted}
          showAsUsed={settings.showAsUsed}
          compactMetrics={providerView.selectedProviderId === null}
          onLayoutChange={requestLayout}
        />
      </div>
    );
  };

  if (providerView.sorted.length === 0) {
    return (
      <div className={revealClassName}>
        <MenuSurface
          variant="tray"
          onRefresh={refresh}
          isRefreshing={isRefreshing}
          actions={headerActions}
          headerActionsLead={xNotificationButton}
          headerPanel={xNotificationPanel}
          footerLead={zoomRow}
          footerRows={footerRows}
          style={traySurfaceStyle}
        >
          {settings.agentSessionsEnabled && <AgentSessions />}
          <MenuEmpty
            isLoading={isRefreshing && !hasCachedData}
            onSettings={openSettings}
          />
        </MenuSurface>
        <TrayResizeHandles />
      </div>
    );
  }

  return (
    <div className={revealClassName}>
      <MenuSurface
        variant="tray"
        onRefresh={refresh}
        isRefreshing={isRefreshing}
        actions={headerActions}
        headerActionsLead={xNotificationButton}
        headerPanel={xNotificationPanel}
        footerLead={zoomRow}
        footerRows={footerRows}
        style={traySurfaceStyle}
      >
        {settings.agentSessionsEnabled && <AgentSessions />}
        <ProviderGrid
          providers={
            providerView.expectsDenseOverview
              ? providerView.denseProviders
              : providerView.sorted
          }
          selectedProviderId={providerView.selectedProviderId}
          showAsUsed={settings.showAsUsed}
          showProviderIcons={settings.switcherShowsIcons}
          expanded={providerView.gridExpanded}
          onExpandedChange={providerView.setGridExpanded}
          onSelect={providerView.setSelectedProviderId}
          onReorder={handleReorder}
          onGestureStart={handleGestureStart}
          onGestureEnd={handleGestureEnd}
        />
        <div className="provider-grid__divider" />
        <div className="menu-stack">
          {useWideColumns
            ? wideColumns.map((column, index) => (
                <div className="menu-stack__column" key={index}>
                  {column.map(renderProviderCard)}
                </div>
              ))
            : providerView.visibleProviders.map((provider, index) => (
                <Fragment key={provider.providerId}>
                  {index > 0 && <div className="menu-stack__sep" />}
                  {renderProviderCard(provider)}
                </Fragment>
              ))}
        </div>
        <TrayContextActions providerId={providerView.selectedProviderId} />
      </MenuSurface>
      <TrayResizeHandles />
    </div>
  );
}
