# Product

## Register

product

## Users

Windows developers who work across several AI coding tools and need a quiet, trustworthy view of quota, reset timing, and pace while they remain in their editor or terminal. The primary workflow is glance first, then open the tray panel or Settings only when a provider or display decision needs attention.

## Product Purpose

Win-CodexBar keeps AI coding-tool usage visible from the Windows tray without making users open multiple provider dashboards. It combines truthful provider usage windows, remaining capacity, reset timing, pace signals, a compact X watchlist for selected AI accounts, provider setup, and desktop display controls in a compact native workflow.

Success means a user can understand their current capacity in a few seconds, trust that missing or ambiguous provider data is shown honestly, and configure the app without losing their place or having the app steal focus.

## Brand Personality

Calm, precise, unobtrusive. The interface should feel like a dependable instrument for an active developer workstation: dense where the data matters, quiet when it does not, and explicit about uncertainty.

## Anti-references

- Do not become a dashboard maze that requires opening a full web page for a glanceable status.
- Do not lead with cost estimates, decorative analytics, or model attribution when the user is asking about capacity.
- Do not use playful decoration, gratuitous motion, oversized cards, or fashionable visual effects that compete with coding work.
- Do not hide provider ambiguity behind fabricated percentages, mislabeled windows, or color-only meaning.

## Design Principles

1. **Glanceable hierarchy:** remaining capacity, reset timing, and pace lead; configuration and diagnostics stay one step deeper.
2. **Truthful windows:** duration and provider semantics are authoritative; unavailable data stays visibly unavailable.
3. **Native trust:** tray-first surfaces, predictable focus behavior, startup reliability, and no-activate overlays should feel at home on Windows.
4. **Quiet density:** fit the information users need into compact surfaces without clipping, scroll traps, or decorative noise.
5. **State over decoration:** color, motion, and emphasis communicate quota health, loading, warning, error, and selection states only.
6. **Reviewed upstream changes:** customized Windows builds link to the original repository for awareness but never download or apply upstream updates automatically.

## Accessibility & Inclusion

- Preserve keyboard navigation, visible focus, semantic labels, and accessible/title context for truncated content.
- Do not rely on color alone for quota or pace meaning; retain explicit percentages, signs, labels, and reset text.
- Keep contrast readable in dark and light themes and support reduced-motion preferences for transitions.
- Preserve localization coverage and avoid layout assumptions that break on translated labels or long provider names.
- Keep FloatBar click-through and no-activate behavior passive so it never steals focus or input from the user's active work.
- Keep Pace in the tray, pop-out, provider-detail, history, and warning surfaces; the detached FloatBar shows capacity and account-expiry status only, with no Pace pills or signed Pace percentages.
- Keep X notification badges in the tray dashboard, lists bounded, and exact-post navigation user initiated; the
  passive FloatBar must remain notification-free.
- Retain a rolling seven-day X notification ledger in the backend. Every newly discovered watched-account post,
  reply, or repost in that window should enter the tray inbox once, including catch-up items missed by an earlier poll.
