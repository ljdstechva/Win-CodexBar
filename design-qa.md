# Design QA - Subscription Visibility and X Notifications

- Build: CodexBar Desktop 0.45.2
- Platform: Windows 11, installed release executable
- Theme/layout: dark theme, saved vertical FloatBar layout, 100% tray zoom
- Captures: `artifacts/main-v0.45.2-live-qa`

## Live results

- FloatBar displays `ChatGPT Pro` with a genuine future countdown and the OpenAI/Codex mark.
- FloatBar displays `Claude Max 5x` with its genuine future countdown.
- The unavailable Codex 5h lane displays `—`; it does not fabricate `0%` or `100%` and does not relabel a non-5h window.
- Capacity/reset values and Claude `FA` remain visible; no Pace pill, Pace percentage, or Pace-sized empty space remains on the FloatBar.
- The tray provider headers expose the same localized countdowns through visible text and absolute-date accessibility descriptions.
- The X panel remains attached to the tray dashboard, lists `@thsottiaux`, `@OpenAI`, and `@sama`, exposes `Check now`, and completed a fresh live check with the empty state `No new posts.`
- X bridge failures have a sanitized visible warning instead of masquerading as an empty state; rejection behavior is covered by frontend and backend regression tests.
- No X notification control or content appears on the FloatBar.

## Captures

- `floatbar-vertical-live.jpg` (205 x 210): four complete capacity/account entries, truthful unavailable lane, OpenAI mark, both subscription countdowns, no Pace.
- `tray-subscriptions-live.jpg` (340 x 836): tray provider cards plus ChatGPT and Claude countdown text.
- `x-notifications-live.jpg` (340 x 836): expanded X panel after a live check, watched handles, `Check now`, checked-status footer, and empty state.

## Accessibility checks

- Codex usage description reports `5h — / 7d 60% remaining`.
- ChatGPT account description includes the absolute entitlement boundary `Jul 23, 2026, 9:52 AM`.
- Claude account description includes the absolute billing boundary `Aug 18, 2026, 12:29 PM`.
- The X toolbar control is exposed as `X notifications`; the expanded panel exposes `Check now`, `No new posts.`, and its checked-status footer.

## Regression checks

- Only exact 300-minute and 10,080-minute windows map to `5h` and `7d`.
- Informational, unknown-duration, daily, and monthly windows remain unavailable.
- Provider errors render unavailable dashes in red; ordinary unavailable dashes remain gray.
- Failed mark-all persistence restores unread state so the frontend and backend cannot diverge.

Final result: passed. Read-only supervisor final audit: APPROVED.
