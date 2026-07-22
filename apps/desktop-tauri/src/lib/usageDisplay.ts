import type { RateWindowSnapshot } from "../types/bridge";

export function displayUsagePercent(
  rate: RateWindowSnapshot,
  showAsUsed: boolean,
): number {
  const used = Number.isFinite(rate.usedPercent)
    ? Math.max(0, rate.usedPercent)
    : 0;
  if (showAsUsed) {
    return used;
  }

  const remaining = Number.isFinite(rate.remainingPercent)
    ? rate.remainingPercent
    : 100 - used;
  return Math.max(0, Math.min(100, remaining));
}

export function displayUsageBarPercent(
  rate: RateWindowSnapshot,
  showAsUsed: boolean,
): number {
  return Math.min(100, displayUsagePercent(rate, showAsUsed));
}

export const formatPaceEta = (seconds: number): string => {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.round(hours / 24)}d`;
};
