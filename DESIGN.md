---
name: Win-CodexBar
description: A quiet Windows tray instrument for truthful AI coding-tool capacity and pace.
colors:
  app-bg: "#1c1c1e"
  panel-bg: "#2c2c2e"
  panel-border: "#ffffff14"
  surface-elevated: "#ffffff0d"
  text-primary: "#f5f5f7"
  text-secondary: "#8e8e93"
  text-muted: "#ebebf580"
  accent: "#0a84ff"
  focus-ring: "#0a84ff80"
  status-ok: "#22c55e"
  status-stale: "#f59e0b"
  status-error: "#ff453a"
  floatbar-surface: "#0f172a"
  floatbar-text: "#f8fafc"
  quota-green: "#4ade80"
  quota-yellow: "#fde047"
  quota-orange: "#fb923c"
  quota-red: "#f87171"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.3
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "3px"
  md: "6px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  floatbar-pill:
    backgroundColor: "{colors.floatbar-surface}"
    textColor: "{colors.floatbar-text}"
    rounded: "{rounded.pill}"
    padding: "1px 5px"
    height: "16px"
  floatbar-account-pill:
    backgroundColor: "{colors.floatbar-surface}"
    textColor: "{colors.floatbar-text}"
    rounded: "{rounded.pill}"
    padding: "1px 6px"
    height: "16px"
  panel:
    backgroundColor: "{colors.panel-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "16px"
  settings-tab-active:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "5px 12px"
  ghost-button:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
---

# Design System: Win-CodexBar

## Overview

**Creative North Star: "The Quiet Instrument"**

Win-CodexBar is a compact, native-feeling instrument for an active developer workstation. It should be understood at a glance, then recede: capacity, reset timing, and pace are the signal; configuration and diagnostics stay one deliberate step deeper. The visual language is dark, cool, and restrained, with small high-contrast state colors doing functional work rather than decoration.

The system rejects dashboard sprawl, cost-led analytics, playful ornament, and fashionable effects that compete with an editor. It favors predictable Windows surfaces, honest unavailable states, clear focus behavior, and dense but breathable rows. The FloatBar is a passive always-on-top overlay; it must never steal focus or input from the user's active work.

**Key Characteristics:**

- Glance-first hierarchy with remaining capacity before configuration.
- Cool charcoal surfaces with one blue action accent.
- Green/yellow/orange/red reserved for explicit quota and pace states.
- Compact geometry with tabular numerals and stable labels.
- Native, no-activate behavior for tray and FloatBar surfaces.

## Colors

The palette is a quiet charcoal foundation with a single system-blue action voice. State colors are intentionally saturated so quota health remains legible in a small FloatBar without turning the rest of the interface into a warning dashboard.

### Primary

- **System Blue:** the single action and focus accent for selected controls, links, and keyboard focus.

### Neutral

- **Charcoal App:** the default dark application canvas and fallback window background.
- **Elevated Graphite:** the tray/settings panel surface, usually rendered with a translucent overlay.
- **Primary White:** the main readable text color.
- **Secondary Gray:** labels, hints, and supporting metadata.
- **Muted White:** low-emphasis descriptions and disabled content.
- **FloatBar Navy:** the high-contrast overlay surface that stays readable over arbitrary desktop content.

### State

- **Capacity Green:** 50% or more remaining, and pace at or below zero.
- **Capacity Yellow:** below 50% remaining.
- **Capacity Orange:** below 30% remaining.
- **Capacity Red:** below 10% remaining, exhausted, or pace above zero.

**The One Signal Rule.** Use color to expose an existing state, never to decorate a neutral row. Percentages, signs, labels, and reset text must remain present so color is never the sole meaning.

## Typography

**Display Font:** System UI (`-apple-system`, `Segoe UI Variable`, Inter, `Segoe UI`, system-ui)
**Body Font:** The same system stack, with antialiased rendering and tabular numerals where values are compared.
**Label/Mono Font:** Cascadia Code / Consolas only for literal identifiers and technical values.

**Character:** Compact, calm, and highly legible at small Windows sizes. Weight carries hierarchy more often than oversized type.

### Hierarchy

- **Title** (600, 17px, 1.3): settings and provider detail headings.
- **Headline** (600, 13px, 1.3): section and provider names.
- **Body** (400, 13px, 1.3): normal settings and explanatory copy.
- **Label** (600, 11px, 1.3): FloatBar windows, metadata, and compact control labels.
- **Caption** (400, 10–11px): hints, reset descriptions, and secondary status.

**The Stable Numbers Rule.** Usage, pace, reset time, and thresholds use tabular numerals so changing values do not make neighboring labels jump.

## Elevation

Depth comes from tonal layering, a hairline border, and a restrained ambient shadow rather than stacked cards or heavy blur. The tray panel uses a graphite surface; the FloatBar uses dark navy glass with a subtle inset highlight and small shadow so it remains distinct without becoming a billboard.

### Shadow Vocabulary

- **Panel ambient:** `0 8px 32px rgba(0, 0, 0, 0.4)` for tray/settings surfaces.
- **FloatBar lift:** `0 2px 5px rgba(0, 0, 0, 0.42)` with a faint inset white edge.
- **Control active:** `0 1px 3px rgba(0, 0, 0, 0.2)` for selected settings tabs.

**The Quiet Elevation Rule.** Shadows separate a surface from its context; they never become the visual subject.

## Components

### FloatBar Pills

- **Shape:** compact capsule (`999px`) with `1px 5px` internal padding and a `16px` minimum height.
- **Color assignment:** dark navy surface with light text; quota values use the explicit remaining-capacity state colors. Pace colors remain part of the dashboard/detail system, not the detached FloatBar.
- **States:** unavailable quota values render an em dash; weekly-only provider data stays labeled `7d`; reset text is optional and remains localized. A plan without an authoritative future subscription date renders the localized `expiry unavailable` account state.
- **Content boundary:** the detached FloatBar contains capacity and optional account-expiry pills only. It never renders Pace pills or signed Pace percentages.
- **Behavior:** the native overlay stays always-on-top and no-activate. When click-through is enabled, native cursor bounds detection lowers the whole bar to 10% opacity while preserving input transparency.

### Tray X Notifications

- **Badge:** a compact bell sits in the tray-opened dashboard toolbar beside refresh and pop-out; unread count uses a red numeric badge with a `99+` cap. The FloatBar never renders notification controls.
- **Panel:** the graphite notification list opens directly below the toolbar inside the tray GUI, remains bounded and scrollable, and shows author, handle, relative time, post/reply/repost kind, and a three-line excerpt.
- **Behavior:** selecting an item marks it read and opens its exact `x.com/{handle}/status/{id}` URL in the default browser. Outside pointer input, the bell, or Escape closes the panel without changing FloatBar interaction state.

### Settings Tabs

- **Shape:** a compact segmented row with `1px` spacing, `7px` group radius, and `5px 12px` tab padding.
- **Default:** transparent background and secondary gray text.
- **Hover / active:** primary text on hover; active tabs use an elevated white tint and a light ambient shadow.
- **Focus:** keep a visible accent focus ring for keyboard navigation.

### Panels and Fields

- **Panel:** elevated graphite, `12px` radius, `16px` padding, and a subtle hairline border.
- **Field row:** translucent white tint, `6px` radius, `6px 10px` padding, and a small hover lift in background only.
- **Input:** translucent field surface, `6–8px` radius, system text, and a `2px` accent outline on focus.

### Ghost Buttons and Toggles

- **Ghost button:** provider-row surface, `6px` radius, `6px 10px` padding, and a slightly brighter background on hover.
- **Toggle:** compact `16px` checkbox treatment with the system-blue checked state and a visible focus outline.
- **Disabled:** reduce opacity and use a not-allowed cursor; do not remove the label or explanation.

## Do's and Don'ts

### Do:

- **Do** keep remaining capacity, reset timing, and pace above decorative or cost information.
- **Do** preserve truthful `5h` and `7d` labels based on actual provider window duration.
- **Do** retain explicit signs, percentages, reset text, and em dashes for unavailable values.
- **Do** use the dark FloatBar treatment and the quota thresholds defined above consistently.
- **Do** keep focus visible, keyboard navigation intact, localization-safe, and reduced-motion friendly.
- **Do** test the tray and FloatBar passively so the user's active window and input are not disturbed.
- **Do** keep X polling credential-safe, persist unread state locally, and avoid showing old profile history as a flood of new alerts.

### Don't:

- **Don't** become a dashboard maze that requires opening a full web page for a glanceable status.
- **Don't** lead with cost estimates, decorative analytics, or model attribution when the user is asking about capacity.
- **Don't** use playful decoration, gratuitous motion, oversized cards, or fashionable visual effects that compete with coding work.
- **Don't** hide provider ambiguity behind fabricated percentages, mislabeled windows, or color-only meaning.
- **Don't** steal focus, synthesize input, or turn click-through into a false interactive affordance.
