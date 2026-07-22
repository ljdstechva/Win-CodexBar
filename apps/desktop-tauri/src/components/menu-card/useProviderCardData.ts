import { useEffect, useState } from "react";
import type { ProviderChartData } from "../../types/bridge";
import { getProviderChartData } from "../../lib/tauri";
import { providerSupportsChartData } from "../../lib/providerCharts";

interface ProviderCardDataOptions {
  providerId: string;
  accountEmail: string | null;
  onLayoutChange?: () => void;
}

export const useProviderCardData = ({
  providerId,
  accountEmail,
  onLayoutChange,
}: ProviderCardDataOptions): ProviderChartData | null => {
  const [chartData, setChartData] = useState<ProviderChartData | null>(null);

  useEffect(() => {
    if (!providerSupportsChartData(providerId)) {
      setChartData(null);
      return;
    }

    let cancelled = false;
    setChartData(null);
    getProviderChartData(providerId, accountEmail ?? undefined)
      .then((data) => {
        if (cancelled) return;
        setChartData(data);
        requestAnimationFrame(() => onLayoutChange?.());
      })
      .catch(() => {
        // Chart and local-token data are best-effort enhancements.
      });

    return () => {
      cancelled = true;
    };
  }, [accountEmail, onLayoutChange, providerId]);

  return chartData;
};
