# Usage Card Components

## Purpose

- Own the focused presentation and data-loading modules composed by `components/MenuCard.tsx`.

## Ownership

- `presentation.ts` owns framework-free usage-card derivation and formatting.
- `useProviderCardData.ts` owns best-effort bridge loading for chart and local-token data.
- React components in this folder own one stable DOM section each.
- `WayfinderUsage.tsx` owns Wayfinder telemetry without introducing quota or identity rows.

## Local Contracts

- Preserve `MenuCard` element order, class names, accessibility labels, and visible behavior during structural refactors.
- Keep bridge calls out of presentational components.
- Usage cards show remaining quota, token totals, and separately labeled 5-hour/weekly Pace bars when those
  snapshots are available; cost/model/estimate content stays absent.
- Duration is authoritative for primary/weekly labels. A weekly-only primary snapshot must remain weekly and must not
  be presented as a session window.
- Wayfinder cards show gateway telemetry and savings but omit generic quota, account, and plan presentation.

## Work Guidance

- Prefer pure functions for derived display state and focused components for markup sections.
- Do not add dependencies for card-specific domain logic.

## Verification

- Run `pnpm exec vitest run src/components/MenuCard.test.tsx` and the full frontend suite after changes.

## Child DOX Index

- No child instruction files.
