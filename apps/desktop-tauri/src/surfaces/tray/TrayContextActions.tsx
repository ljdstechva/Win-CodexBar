import { useLocale } from "../../hooks/useLocale";
import {
  openProviderDashboard,
  openProviderStatusPage,
} from "../../lib/tauri";
import {
  hasProviderDashboard,
  hasProviderStatusPage,
} from "./providerCapabilities";

interface TrayContextActionsProps {
  providerId: string | null;
}

const TrayContextActions = ({ providerId }: TrayContextActionsProps) => {
  const { t } = useLocale();
  if (!providerId) return null;

  const hasDashboard = hasProviderDashboard(providerId);
  const hasStatusPage = hasProviderStatusPage(providerId);
  if (!hasDashboard && !hasStatusPage) return null;

  return (
    <div className="context-actions">
      <div className="context-actions__divider" />
      {hasDashboard && (
        <button
          type="button"
          className="context-actions__btn"
          onClick={() => void openProviderDashboard(providerId)}
        >
          <span className="context-actions__icon" aria-hidden>
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="2" y="9" width="2.5" height="5" rx="0.6" fill="currentColor" />
              <rect x="6.75" y="6" width="2.5" height="8" rx="0.6" fill="currentColor" />
              <rect x="11.5" y="3" width="2.5" height="11" rx="0.6" fill="currentColor" />
            </svg>
          </span>
          {t("ActionUsageDashboard")}
        </button>
      )}
      {hasStatusPage && (
        <button
          type="button"
          className="context-actions__btn"
          onClick={() => void openProviderStatusPage(providerId)}
        >
          <span className="context-actions__icon" aria-hidden>
            <svg
              width="14"
              height="13"
              viewBox="0 0 18 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M1 7H4L5.5 3L8 11L10.5 5L12 7H17"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </span>
          {t("ActionStatusPage")}
        </button>
      )}
    </div>
  );
};

export default TrayContextActions;
