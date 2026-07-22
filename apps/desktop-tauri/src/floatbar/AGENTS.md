# FloatBar Surface Modules

## Purpose

- Own the detached Windows FloatBar overlay: native lifecycle coordination, provider-window derivation, and compact pill presentation.

## Ownership

- `FloatBar.tsx` owns the compact composition root and provider selection.
- `FloatBarPills.tsx` owns provider capacity and account markup without bridge calls or window side effects.
- `model.ts` owns pure window classification, quota tones, account privacy filtering, provider selection, and display formatting.
- `useFloatBarSettings.ts` owns detached settings refresh and passive cursor polling; `useFloatBarWindow.ts` owns body transparency, drag, sizing, and opacity.
- `api.ts` owns the native FloatBar command bridge; `FloatBar.css` owns overlay geometry, contrast, and state colors.
- `SettingsSection.tsx` owns the FloatBar controls exposed inside the accepted Display tab.

## Local Contracts

- FloatBar remains native, always-on-top, no-activate, and focus-safe. Windows uses the native watchdog to reassert the topmost z-order band.
- Click-through preserves input transparency, removes the drag grip, and uses native cursor bounds detection to fade the entire bar to 10% opacity while hovered.
- Do not render X notifications, badges, lists, or interactive controls on the FloatBar; those belong to the tray GUI.
- The optional account pill is non-interactive and shows only a normalized plan type plus a countdown from a genuine
  future subscription end date. When a plan exists without a future date, show the localized `expiry unavailable`
  fallback; hide it only when both values are absent. Never show email, cost, or inferred expiry data.
- ChatGPT entitlement stays in the `chatgpt` account-only provider and is presentation-anchored exactly once after the
  related Codex capacity pill. It must never fabricate a capacity window or duplicate the Codex plan pill.
- Capacity is always remaining quota: `50%+` green, `<50%` yellow, `<30%` orange, `<10%` red; exhausted/error states are red.
- FloatBar never renders Pace pills, signed Pace percentages, or Pace-derived sizing. Preserve Pace in the tray dashboard, pop-out dashboard, provider details, history, and predictive warnings.
- Window duration is authoritative and unavailable values render an em dash.
- When Claude exposes its scoped `Fable only` quota, append an `FA` remaining-percentage row to Claude's capacity pill with the standard quota colors and its own reset icon/time when supplied; hide unavailable data, never borrow another window's reset, and never add it to other providers.
- Preserve FloatBar DOM classes, right alignment for vertical pills, dark high-contrast treatment, localization-safe reset text, and passive testing behavior.
- Do not reintroduce cost, model attribution, fabricated windows, or menu/detail `showAsUsed` semantics into the overlay.

## Work Guidance

- Keep derived state framework-free and test it in `model.test.ts`.
- Keep native side effects in `FloatBar.tsx` or `api.ts`; keep pill components presentational.
- Preserve stable compact geometry, tabular numerals, visible labels, and reduced-motion behavior when changing styles.
- Prefer passive Windows validation that never activates a window or synthesizes user input while the workstation is in use.

## Verification

- Run `pnpm exec vitest run src/floatbar/FloatBar.test.tsx src/floatbar/model.test.ts` for focused behavior.
- Run `pnpm run build` and the full frontend suite after changes.
- For native overlay changes, rebuild the Tauri release and perform a no-activate live capture plus topmost/focus regression check.

## Child DOX Index

- No child instruction files.
