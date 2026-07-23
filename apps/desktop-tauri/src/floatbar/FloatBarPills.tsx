import type { CSSProperties } from "react";
import { useFormattedResetTime } from "../hooks/useFormattedResetTime";
import { displayUsagePercent } from "../lib/usageDisplay";
import { ProviderIcon } from "../components/providers/ProviderIcon";
import { getProviderIcon } from "../components/providers/providerIcons";
import { subscriptionCountdown } from "../components/menu-card/presentation";
import type { ProviderUsageSnapshot } from "../types/bridge";
import {
  type AccountSummary,
  classifyFloatBarWindows,
  fableOnlyWindow,
  FLOAT_BAR_NO_VALUE,
  inlineResetTime,
  remainingTone,
} from "./model";

/** Non-interactive provider plan/expiry summary for the no-activate overlay. */
export function AccountPill({
  provider,
  summary,
  scale,
  now,
  countdownLeft,
}: {
  provider: ProviderUsageSnapshot;
  summary: AccountSummary;
  scale: number;
  now: Date;
  countdownLeft: string;
}) {
  const countdown = subscriptionCountdown(summary.endsAt, now);
  const value = countdown
    ? `${summary.planLabel} · ${countdownLeft.replace("{}", countdown)}`
    : summary.planLabel;
  const expiryMs = summary.endsAt ? Date.parse(summary.endsAt) : Number.NaN;
  const absoluteExpiry = Number.isNaN(expiryMs)
    ? null
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(expiryMs));
  const title = absoluteExpiry
    ? `${provider.displayName}: ${value} (${absoluteExpiry})`
    : `${provider.displayName}: ${value}`;
  const brand = getProviderIcon(provider.providerId).brandColor;
  const iconSize = Math.round(10 * scale);

  return (
    <div
      className="floatbar__pill floatbar__account"
      title={title}
      data-tauri-drag-region
      style={{ "--brand": brand } as CSSProperties}
    >
      <span className="floatbar__provider-icon" data-tauri-drag-region>
        <ProviderIcon providerId={provider.providerId} size={iconSize} />
      </span>
      <span className="floatbar__account-text" data-tauri-drag-region>
        {value}
      </span>
    </div>
  );
}

function ResetIcon({ size }: { size: number }) {
  return (
    <svg
      className="floatbar__reset-icon-svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12.9 7.1a5 5 0 1 0-1.2 3.9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M12.9 3.8v3.3H9.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Capacity pill for a single provider and its available quota windows. */
export function ProviderPill({
  provider,
  scale,
  showResetInline,
  resetRelative,
  remainingSuffix,
  fiveHourLabel,
  sevenDayLabel,
  fableLabel,
}: {
  provider: ProviderUsageSnapshot;
  scale: number;
  showResetInline: boolean;
  resetRelative: boolean;
  remainingSuffix: string;
  fiveHourLabel: string;
  sevenDayLabel: string;
  fableLabel: string;
}) {
  // The accepted floating-bar contract is remaining capacity. Keep it
  // independent from the menu/detail "show as used" preference.
  const { fiveHour, sevenDay } = classifyFloatBarWindows(provider);
  const fable = fableOnlyWindow(provider);
  const displaySuffix = remainingSuffix;
  const fiveHourRemaining = fiveHour
    ? Math.max(0, Math.min(100, fiveHour.remainingPercent))
    : null;
  const fiveHourDisplayPercent = fiveHour
    ? Math.round(displayUsagePercent(fiveHour, false))
    : null;
  const fiveHourTone =
    provider.error
      ? "red"
      : fiveHourRemaining == null
        ? null
      : remainingTone(
          fiveHourRemaining,
          Boolean(fiveHour?.isExhausted),
        );
  const sevenDayRemaining = sevenDay
    ? Math.max(0, Math.min(100, sevenDay.remainingPercent))
    : null;
  const sevenDayDisplayPercent = sevenDay
    ? Math.round(displayUsagePercent(sevenDay, false))
    : null;
  const sevenDayTone =
    provider.error
      ? "red"
      : sevenDayRemaining == null
        ? null
      : remainingTone(
          sevenDayRemaining,
          Boolean(sevenDay?.isExhausted),
        );
  const fableRemaining = fable
    ? Math.max(0, Math.min(100, fable.remainingPercent))
    : null;
  const fableDisplayPercent = fable
    ? Math.round(displayUsagePercent(fable, false))
    : null;
  const fableTone =
    provider.error
      ? "red"
      : fableRemaining == null
        ? null
      : remainingTone(
          fableRemaining,
          Boolean(fable?.isExhausted),
        );

  const brand = getProviderIcon(provider.providerId).brandColor;
  const fiveHourValue =
    provider.error || fiveHourDisplayPercent == null
      ? FLOAT_BAR_NO_VALUE
      : `${fiveHourDisplayPercent}%`;
  const sevenDayValue =
    provider.error || sevenDayDisplayPercent == null
      ? FLOAT_BAR_NO_VALUE
      : `${sevenDayDisplayPercent}%`;
  const fableValue =
    provider.error || fableDisplayPercent == null
      ? FLOAT_BAR_NO_VALUE
      : `${fableDisplayPercent}%`;
  const fiveHourResetText = useFormattedResetTime(
    fiveHour?.resetsAt ?? null,
    fiveHour?.resetDescription ?? null,
    resetRelative,
  );
  const inlineFiveHourReset = fiveHourResetText
    ? inlineResetTime(fiveHourResetText)
    : null;
  const sevenDayResetText = useFormattedResetTime(
    sevenDay?.resetsAt ?? null,
    sevenDay?.resetDescription ?? null,
    resetRelative,
  );
  const inlineSevenDayReset = sevenDayResetText
    ? inlineResetTime(sevenDayResetText)
    : null;
  const fableResetText = useFormattedResetTime(
    fable?.resetsAt ?? null,
    fable?.resetDescription ?? null,
    resetRelative,
  );
  const inlineFableReset = fableResetText
    ? inlineResetTime(fableResetText)
    : null;
  const iconSize = Math.round(11 * scale);
  const resetIconSize = Math.round(10 * scale);
  const title = [
    `${fiveHourLabel} ${fiveHourValue}${fiveHour ? ` ${displaySuffix}` : ""}${fiveHourResetText ? `, ${fiveHourResetText}` : ""}`,
    `${sevenDayLabel} ${sevenDayValue}${sevenDay ? ` ${displaySuffix}` : ""}${sevenDayResetText ? `, ${sevenDayResetText}` : ""}`,
    fable
      ? `${fableLabel} ${fableValue} ${displaySuffix}${fableResetText ? `, ${fableResetText}` : ""}`
      : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <div
      className="floatbar__pill floatbar__capacity"
      title={`${provider.displayName}: ${title}`}
      data-tauri-drag-region
      style={{ "--brand": brand } as CSSProperties}
    >
      <span className="floatbar__provider-icon" data-tauri-drag-region>
        <ProviderIcon providerId={provider.providerId} size={iconSize} />
      </span>
      <span className="floatbar__usage-items" data-tauri-drag-region>
        <span className="floatbar__usage-row" data-tauri-drag-region>
          <span className="floatbar__usage-label" data-tauri-drag-region>
            {fiveHourLabel}
          </span>
          <span
            className="floatbar__pct"
            data-usage-tone={fiveHourTone ?? undefined}
            data-unavailable={!fiveHour || provider.error || undefined}
            data-tauri-drag-region
          >
            {fiveHourValue}
          </span>
          {showResetInline && fiveHourResetText && inlineFiveHourReset && (
            <span
              className="floatbar__reset"
              title={fiveHourResetText}
              aria-label={fiveHourResetText}
              data-tauri-drag-region
            >
              <ResetIcon size={resetIconSize} />
              <span className="floatbar__reset-time" data-tauri-drag-region>
                {inlineFiveHourReset}
              </span>
            </span>
          )}
        </span>
        <span className="floatbar__usage-row" data-tauri-drag-region>
          <span className="floatbar__usage-label" data-tauri-drag-region>
            {sevenDayLabel}
          </span>
          <span
            className="floatbar__pct"
            data-usage-tone={sevenDayTone ?? undefined}
            data-unavailable={!sevenDay || provider.error || undefined}
            data-tauri-drag-region
          >
            {sevenDayValue}
          </span>
          {sevenDayResetText && inlineSevenDayReset && (
            <span
              className="floatbar__reset"
              title={sevenDayResetText}
              aria-label={sevenDayResetText}
              data-tauri-drag-region
            >
              <ResetIcon size={resetIconSize} />
              <span className="floatbar__reset-time" data-tauri-drag-region>
                {inlineSevenDayReset}
              </span>
            </span>
          )}
        </span>
        {fable && (
          <span
            className="floatbar__usage-row"
            data-usage-window="fable"
            data-tauri-drag-region
          >
            <span className="floatbar__usage-label" data-tauri-drag-region>
              {fableLabel}
            </span>
            <span
              className="floatbar__pct"
              data-usage-tone={fableTone ?? undefined}
              data-unavailable={provider.error || undefined}
              data-tauri-drag-region
            >
              {fableValue}
            </span>
            {fableResetText && inlineFableReset && (
              <span
                className="floatbar__reset"
                title={fableResetText}
                aria-label={fableResetText}
                data-tauri-drag-region
              >
                <ResetIcon size={resetIconSize} />
                <span className="floatbar__reset-time" data-tauri-drag-region>
                  {inlineFableReset}
                </span>
              </span>
            )}
          </span>
        )}
      </span>
    </div>
  );
}
