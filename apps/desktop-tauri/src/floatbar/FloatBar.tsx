import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { subscriptionCountdown } from "../components/menu-card/presentation";
import { useLocale } from "../hooks/useLocale";
import { useProviders } from "../hooks/useProviders";
import type { BootstrapState, ProviderUsageSnapshot } from "../types/bridge";
import { AccountPill, ProviderPill } from "./FloatBarPills";
import "./FloatBar.css";
import {
  accountSummary,
  fableOnlyWindow,
  hasVisibleAccountSummary,
  providerKey,
  selectVisibleProviders,
} from "./model";
import { useFloatBarSettings } from "./useFloatBarSettings";
import { useFloatBarWindow } from "./useFloatBarWindow";

/**
 * The always-on-top floating capacity bar.
 *
 * This surface is a small composition root. Native-window effects live in
 * focused hooks, provider-window derivation is pure, and pills own markup.
 */
export default function FloatBar({ state }: { state: BootstrapState }) {
  const { t } = useLocale();
  const { providers } = useProviders({
    refreshOnMount: false,
  });
  const { settings, clickThroughHovered } = useFloatBarSettings(state.settings);
  const [countdownNow, setCountdownNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setCountdownNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const orientation: "horizontal" | "vertical" =
    settings.floatBarOrientation === "vertical" ? "vertical" : "horizontal";
  const style = settings.floatBarStyle === "taskbar" ? "taskbar" : "floating";
  const scale = Math.max(0.75, Math.min(2, settings.floatBarScale / 100));
  const showResetInline = settings.floatBarShowResetInline;
  const visible = useMemo(
    () =>
      selectVisibleProviders(
        providers,
        settings.enabledProviders,
        settings.floatBarProviderIds,
      ),
    [providers, settings.enabledProviders, settings.floatBarProviderIds],
  );
  const visibleEntries = useMemo(() => {
    const codexIsVisible = visible.some(
      (provider) => provider.providerId === "codex" && !provider.accountOnly,
    );
    const chatgptAccount = providers.find(
      (provider) =>
        provider.providerId === "chatgpt" &&
        provider.accountOnly === true &&
        provider.error == null,
    );

    return visible
        .filter(
          (provider) =>
            !(
              codexIsVisible &&
              provider.providerId === "chatgpt" &&
              provider.accountOnly
            ),
        )
        .map((provider) => {
          // Codex owns the quota pill. The separate ChatGPT provider owns the
          // authenticated account entitlement and is presentation-anchored
          // immediately after Codex without becoming a second capacity entry.
          const accountProvider: ProviderUsageSnapshot =
            provider.providerId === "codex" && chatgptAccount
              ? chatgptAccount
              : provider;
          const summary = accountSummary(
            accountProvider,
            countdownNow,
            t("ProviderPlanClaudeAi"),
          );
          return {
            provider,
            accountProvider,
            account:
              summary && hasVisibleAccountSummary(summary, countdownNow)
                ? summary
                : null,
          };
        })
        .filter(
          ({ provider, account }) =>
            !provider.accountOnly ||
            (settings.floatBarShowAccount && account != null),
        );
  }, [countdownNow, providers, settings.floatBarShowAccount, t, visible]);

  const visibleMetricValuesKey = visibleEntries
    .map(({ provider, accountProvider, account }) => {
      const fable = fableOnlyWindow(provider);
      return [
        providerKey(provider),
        providerKey(accountProvider),
        provider.primary.windowMinutes ?? "",
        provider.primary.usedPercent ?? "",
        provider.primary.remainingPercent ?? "",
        provider.primary.resetsAt ?? "",
        provider.primary.resetDescription ?? "",
        provider.secondary?.windowMinutes ?? "",
        provider.secondary?.usedPercent ?? "",
        provider.secondary?.remainingPercent ?? "",
        provider.secondary?.resetsAt ?? "",
        provider.secondary?.resetDescription ?? "",
        fable?.usedPercent ?? "",
        fable?.remainingPercent ?? "",
        fable?.isExhausted ?? "",
        fable?.resetsAt ?? "",
        fable?.resetDescription ?? "",
        settings.floatBarShowAccount,
        account?.planLabel ?? "",
        account?.endsAt ?? "",
        account
          ? subscriptionCountdown(account.endsAt, countdownNow) ?? ""
          : "",
      ].join(":");
    })
    .join("|");

  const { startDrag, renderedOpacity } = useFloatBarWindow({
    settings,
    clickThroughHovered,
    visibleLength: visibleEntries.length,
    visibleMetricValuesKey,
    orientation,
    style,
    scale,
    showResetInline,
  });

  return (
    <div
      className={`floatbar floatbar--${orientation} floatbar--${style} floatbar--dark-contrast${settings.floatBarDarkText ? " floatbar--light-bg" : ""}`}
      data-tauri-drag-region
      onMouseDown={startDrag}
      style={
        { opacity: renderedOpacity, "--floatbar-scale": scale } as CSSProperties
      }
    >
      <div className={`floatbar__body floatbar__body--${orientation}`} data-tauri-drag-region>
        {!settings.floatBarClickThrough && (
          <div className="floatbar__handle" data-tauri-drag-region aria-hidden />
        )}
        {visibleEntries.length === 0 ? (
          <div className="floatbar__empty" data-tauri-drag-region>
            {t("FloatBarNoProviders")}
          </div>
        ) : (
          <>
            {visibleEntries.map(({ provider, accountProvider, account }) => (
              <Fragment key={providerKey(provider)}>
                {!provider.accountOnly && (
                  <ProviderPill
                    provider={provider}
                    scale={scale}
                    showResetInline={showResetInline}
                    resetRelative={settings.resetTimeRelative}
                    remainingSuffix={t("FloatBarRemainingSuffix")}
                    fiveHourLabel="5h"
                    sevenDayLabel="7d"
                    fableLabel="FA"
                  />
                )}
                {settings.floatBarShowAccount && account && (
                  <AccountPill
                    provider={accountProvider}
                    summary={account}
                    scale={scale}
                    now={countdownNow}
                    countdownLeft={t("SubscriptionCountdownLeft")}
                  />
                )}
              </Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
