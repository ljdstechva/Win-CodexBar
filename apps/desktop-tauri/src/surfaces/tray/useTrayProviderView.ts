import { useEffect, useMemo, useState } from "react";
import type {
  ProviderCatalogEntry,
  ProviderUsageSnapshot,
} from "../../types/bridge";
import { prioritizeProviders } from "../../components/ProviderGrid";
import { orderProviderSnapshots } from "../../lib/providerOrder";
import {
  hydrateProviderSlots,
  orderedEnabledProviderSlots,
} from "../../lib/trayProviders";

export const DENSE_OVERVIEW_THRESHOLD = 32;

interface TrayProviderViewOptions {
  providers: ProviderUsageSnapshot[];
  catalog: ProviderCatalogEntry[];
  enabledProviderIds: string[];
  providerOrder?: string[];
  initialProviderId: string | null;
}

export const useTrayProviderView = ({
  providers,
  catalog,
  enabledProviderIds,
  providerOrder,
  initialProviderId,
}: TrayProviderViewOptions) => {
  const sorted = useMemo(
    () =>
      orderProviderSnapshots(
        providers,
        catalog,
        enabledProviderIds,
        providerOrder,
      ),
    [catalog, enabledProviderIds, providerOrder, providers],
  );
  const denseSlots = useMemo(
    () =>
      orderedEnabledProviderSlots(
        catalog,
        enabledProviderIds,
        sorted,
        providerOrder,
      ),
    [catalog, enabledProviderIds, providerOrder, sorted],
  );
  const providersById = useMemo(
    () => new Map(sorted.map((provider) => [provider.providerId, provider])),
    [sorted],
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    initialProviderId,
  );
  const [gridExpanded, setGridExpanded] = useState(false);
  const expectsDenseOverview =
    selectedProviderId === null &&
    !gridExpanded &&
    enabledProviderIds.length + 1 > DENSE_OVERVIEW_THRESHOLD;
  const denseProviders = useMemo(
    () =>
      expectsDenseOverview
        ? hydrateProviderSlots(denseSlots, providersById)
        : sorted,
    [denseSlots, expectsDenseOverview, providersById, sorted],
  );
  const visibleProviders = useMemo(() => {
    if (selectedProviderId === null) {
      if (sorted.length + 1 > DENSE_OVERVIEW_THRESHOLD && !gridExpanded) {
        return prioritizeProviders(denseProviders, null).slice(0, 4);
      }
      return sorted;
    }
    const selected = sorted.find(
      (provider) => provider.providerId === selectedProviderId,
    );
    return selected ? [selected] : sorted;
  }, [denseProviders, gridExpanded, selectedProviderId, sorted]);

  useEffect(() => setSelectedProviderId(initialProviderId), [initialProviderId]);

  return {
    sorted,
    denseProviders,
    selectedProviderId,
    setSelectedProviderId,
    gridExpanded,
    setGridExpanded,
    expectsDenseOverview,
    visibleProviders,
  };
};
