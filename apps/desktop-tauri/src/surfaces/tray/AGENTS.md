# Tray Surface Modules

## Purpose

- Own the focused state, native-window lifecycle, provider view model, shortcuts, and controls composed by `surfaces/TrayPanel.tsx`.

## Ownership

- `useTrayProviderView.ts` owns provider ordering, density, selection, and visibility derivation.
- `useFlyoutSize.ts` and `useTrayScale.ts` own persisted native sizing and scale state.
- `useTrayPanelShortcuts.ts` owns tray keyboard behavior.
- `useXNotifications.ts` owns the persisted X watchlist subscription and actions; `XNotifications.tsx` owns the
  toolbar bell, numeric badge, and bounded updates panel.
- Focused components own zoom, context actions, and resize-handle markup.

## Local Contracts

- `TrayPanel.tsx` is the surface orchestrator; keep native lifecycle and derivation out of its render tree.
- Preserve existing tray DOM order, classes, keyboard shortcuts, sizing behavior, and bridge commands during refactors.
- The tray must keep Pace and token totals visible and cost/model/estimate content absent.
- Keep the X notification control in the tray toolbar, never on the FloatBar. The panel opens directly below the
  toolbar, remains bounded and scrollable, lists only `@thsottiaux`, `@OpenAI`, and `@sama`, and opens exact status
  URLs only after user selection. Escape closes the panel before dismissing the tray window.
- Never expose, log, or persist X/browser cookies.
- Keep Agent Sessions in a bounded scrolling list; long workspace names truncate visually while retaining their full
  value as accessible/title context so session discovery cannot expand the tray without limit.

## Work Guidance

- Keep provider capability data in `providerCapabilities.ts` and provider view derivation in `useTrayProviderView.ts`.
- Native-window side effects belong in named hooks or focused controls, not anonymous render callbacks.

## Verification

- Run `pnpm exec vitest run src/surfaces/TrayPanel.test.tsx src/floatbar/FloatBar.test.tsx` and the full frontend suite after changes.

## Child DOX Index

- No child instruction files.
