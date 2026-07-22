import { useEffect, useState } from "react";
import { useLocale } from "../../../hooks/useLocale";
import { getAppInfo, openExternalUrl } from "../../../lib/tauri";
import type { AppInfoBridge } from "../../../types/bridge";
import type { LocaleKey } from "../../../i18n/keys";
import type { TabProps } from "../../Settings";
import codexbarIcon from "../../../assets/codexbar-icon.png";

const UPSTREAM_REPOSITORY = "https://github.com/steipete/CodexBar";

const ABOUT_LINKS: ReadonlyArray<{ labelKey: LocaleKey; url: string }> = [
  {
    labelKey: "AboutLinkGitHub",
    url: "https://github.com/Finesssee/Win-CodexBar",
  },
  {
    labelKey: "AboutLinkWebsite",
    url: "https://codexbar.app",
  },
  {
    labelKey: "AboutLinkOriginalProject",
    url: UPSTREAM_REPOSITORY,
  },
];

export default function AboutTab(_props: TabProps) {
  const { t } = useLocale();
  const [appInfo, setAppInfo] = useState<AppInfoBridge | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    void getAppInfo().then(setAppInfo);
  }, []);

  const openAboutLink = (url: string) => {
    setLinkError(null);
    openExternalUrl(url).catch((error) => {
      setLinkError(String(error));
    });
  };

  if (!appInfo) {
    return (
      <section className="settings-section">
        <p className="settings-section__hint">{t("AboutLoading")}</p>
      </section>
    );
  }

  // Copyright is split into two keys so the brand link can render inline
  // between them, avoiding any Fluent placeholder syntax.
  const copyrightBefore = t("AboutCopyrightBefore");
  const copyrightAfter = t("AboutCopyrightAfter");
  return (
    <section className="settings-section about-section">
      <div className="about-header">
        <img className="about-icon" src={codexbarIcon} alt={t("AppName")} />
        <div className="about-title-block">
          <h2 className="about-title">{appInfo.name}</h2>
          <p className="about-version">
            {t("Version")} {appInfo.version}
            {appInfo.buildNumber !== "dev" && ` (${appInfo.buildNumber})`}
          </p>
          <p className="about-tagline">{appInfo.tagline}</p>
        </div>
      </div>

      <div className="about-links">
        {ABOUT_LINKS.map((link) => (
          <button
            key={link.url}
            type="button"
            className="about-link"
            onClick={() => openAboutLink(link.url)}
          >
            {t(link.labelKey)}
          </button>
        ))}
      </div>
      {linkError && (
        <p className="about-update-msg">
          {t("ErrorPrefix")} {linkError}
        </p>
      )}

      <div className="about-divider" />

      <div className="about-actions">
        <div className="about-update-row">
          <span className="about-update-msg">
            Automatic downloads are disabled for this customized Windows build. Watch the
            original repository and re-port updates only after reviewing them.
          </span>
          <button
            type="button"
            className="credential-btn credential-btn--primary"
            onClick={() => openAboutLink(UPSTREAM_REPOSITORY)}
          >
            Watch steipete/CodexBar on GitHub
          </button>
        </div>
      </div>

      <p className="about-copyright">
        {copyrightBefore}{" "}
        <button
          type="button"
          className="about-link about-link--inline"
          onClick={() => openAboutLink(UPSTREAM_REPOSITORY)}
        >
          {t("AppName")}
        </button>
        {" "}{copyrightAfter}
      </p>
    </section>
  );
}
