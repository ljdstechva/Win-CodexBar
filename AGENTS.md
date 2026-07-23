# Repository Guidelines

## Current Project State
- This branch launches the Tauri desktop shell by default (`apps/desktop-tauri/src-tauri`), while
  `rust/` remains the shared backend/domain crate and standalone CLI.
- Many files in `docs/` and some workflows reference the upstream macOS/Swift project. Treat those as historical or
  upstream-sync material unless the task is explicitly about upstream parity.
- `PRODUCT.md` defines the product register and `DESIGN.md` plus `.impeccable/design.json` define the current UI/design
  system; use them as the starting point for future surface changes.
- When repo docs conflict, trust the active Tauri desktop sources in `apps/desktop-tauri` plus the shared Rust sources
  in `rust/src`.

## Project Structure & Modules
- `apps/desktop-tauri/`: Tauri desktop shell (default UI). React frontend in `apps/desktop-tauri/src/`,
  Rust backend + tray bridge in `apps/desktop-tauri/src-tauri/src/`.
- `rust/src`: Shared backend crate + CLI (`codexbar` binary). Houses providers, settings, login,
  status, sound, shortcuts, browser cookie extraction, and the shared tray-icon renderer.
- `rust/src/providers`: Provider-specific fetch/parsing/auth logic. Keep provider boundaries clean.
- `rust/src/tray` (shared): `icon.rs` + `render.rs` — pixel-level tray-icon rendering used by the Tauri shell.
- `rust/src/browser`: Browser detection + cookie extraction for Windows.
- `rust/src/core`: Shared provider-construction (`instantiate_provider`) and provider IDs.
- `rust/assets`, `rust/icons`, `rust/gen`, `rust/wix`: UI assets, generated schemas, installer packaging.
- `docs`: Mixed documentation (Windows port docs plus upstream/macOS references). Update only the relevant docs.

## Build, Test, Run
- Default desktop work runs from the repo root; `cd rust` is for backend/CLI-only tasks.
- This workspace keeps its approved Rust toolchain outside the repository at `D:\02 systems\01 codex\.tooling`.
  Set `CARGO_HOME` to `.tooling\cargo`, `RUSTUP_HOME` to `.tooling\rustup`, and prepend `.tooling\cargo\bin`
  for native build and test commands; do not add this toolchain to the user or system `PATH`.
- Build the desktop shell (preferred): `cd apps/desktop-tauri && pnpm run tauri:build` (or `tauri:build:debug`).
  Raw `cargo build --release` on the Tauri crate produces an exe that still points at the dev URL.
- Build the CLI: `cargo build -p codexbar`.
- Test: `cargo test --manifest-path rust/Cargo.toml` and
  `cargo test --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml`.
- Run CLI locally: `cargo run -p codexbar -- --help`, `cargo run -p codexbar -- usage -p claude`,
  `cargo run -p codexbar -- cost`. The CLI no longer launches a GUI when run with no subcommand.
- Run the desktop shell through Tauri's build/dev flow: `.\dev.ps1`, `./dev.sh`, or
  `cd apps/desktop-tauri && npm run tauri:dev`.
- Format/lint before handoff when code changed: `cargo fmt --all` and `cargo clippy --all-targets -- -D warnings`
  on both manifests (or explain why not run).
- There is no active root-level `Scripts/` build pipeline in this port. Do not rely on legacy `Scripts/*.sh` commands.

## Coding Style & Naming
- Prefer small, typed structs/enums and focused modules; keep changes local.
- Keep provider-specific logic inside the provider module instead of adding cross-provider branching.
- Preserve clear error handling and user-facing diagnostics (`anyhow`/`thiserror` + friendly messages where applicable).
- Use `tracing` for diagnostics; do not log raw secrets, cookies, or tokens.
- Avoid adding dependencies/tooling without confirmation.

## Testing Guidelines
- Add or extend focused Rust tests near the changed module (`#[cfg(test)]` unit tests are common in this repo).
- For parser/fetcher changes, add deterministic samples/fixtures where practical.
- Run `cargo test` after code changes; include any skipped checks in handoff.
- If desktop/tray behavior changed, do a manual validation with the Tauri shell when possible (`cargo run` or
  `codexbar-desktop-tauri`).

## Commit & PR Guidelines
- Use short imperative commit messages (for example: `Fix Claude CLI parser`, `Improve cookie import errors`).
- Keep commits scoped to one change.
- In PRs/patches, include:
  - Summary of behavior changes
  - Commands run (`cargo test`, `cargo fmt`, etc.)
  - Screenshots/GIFs for UI changes (Windows)
  - Linked issue/reference when relevant

## Release & Winget Notes
- Treat Winget updates as a normal release step after GitHub release artifacts are stable.
- Winget does not track "latest" GitHub releases; every version needs its own immutable manifest folder in
  `microsoft/winget-pkgs`, for example `manifests/f/Finesssee/Win-CodexBar/0.23.6/`.
- For routine version bumps, copy the previous approved manifest folder and change only version-specific fields:
  `PackageVersion`, `InstallerUrl`, `InstallerSha256`, `DisplayName`, `DisplayVersion`, `ReleaseNotes`, and
  `ReleaseNotesUrl`.
- Keep stable package identity and installer behavior unchanged unless there is a real packaging reason:
  `PackageIdentifier`, `InstallerType`, `Scope`, `ProductCode`, `Publisher`, package URLs, and silent install behavior.
- Before opening a Winget PR, verify the release installer URL resolves and recompute the SHA-256 from the downloaded
  asset. On Windows, run `winget validate` when available.
- The first Winget package submission was approved in `microsoft/winget-pkgs#366653`; the v0.23.5 update was approved
  in `microsoft/winget-pkgs#366794`. Future updates should be faster, but still expect Microsoft validation/review.

## Agent Notes
- The default desktop app is the Tauri shell in `apps/desktop-tauri/`. The Rust crate owns shared backend logic
  and the CLI.
- New provider construction goes through `codexbar::core::instantiate_provider` — do not duplicate provider
  factories in shells or commands.
- Keep provider data siloed: never show identity/plan/email fields from provider A in provider B UI.
- Claude CLI output is user-configurable; do not depend on a customizable status line for usage parsing.
- Cookie import UX uses explicit browser selection in Preferences. Do not assume Chrome-only in general UI flows.
- Be conservative with secret handling (manual cookies, API keys, token accounts); use existing redaction/storage helpers.
- Usage cards intentionally show remaining quota, local token totals, and separate 5-hour/weekly Pace bars when
  both windows provide timing; do not reintroduce cost figures, top-model attribution, local-estimate notes, or
  cost charts without a new user requirement.
- Tray icon fill and percent text follow the selected used/remaining display mode, but their severity color always
  derives from actual percent used: a full remaining quota is green and a nearly exhausted quota is red.
- Settings keeps the accepted five-tab shell (`General`, `Providers`, `Display`, `Advanced`, `About`): use 496 px for
  ordinary tabs and 600 px for Providers. Fold notifications and thresholds into General, and tray/menu/FloatBar
  controls into Display; preserve aliases for the superseded 0.42 tab routes.
- FloatBar remains a native always-on-top, no-activate overlay. On Windows, keep a focus-safe native watchdog that
  periodically reasserts the FloatBar at the front of the topmost z-order band so later topmost windows and shell or
  display transitions cannot leave it behind. FloatBar uses a high-contrast dark treatment and always displays remaining capacity independently of menu/detail
  display mode. Classify `5h`/`7d` by actual window duration; render an unavailable window as `—` instead of relabeling
  weekly data or fabricating 0%. Color each available quota independently: 50% or more green, below 50% yellow, below
  30% orange, below 10% red. Its optional non-interactive account pill shows only the provider's plan type and a
  countdown from a genuine future subscription end date; when a plan exists without an authoritative future date,
  show only the plan. Keep ChatGPT entitlement
  data in its account-only provider and presentation-anchor exactly one ChatGPT account pill after Codex capacity;
  never show email, cost, or inferred expiry data. When Claude supplies its scoped `Fable only` quota, append its remaining percentage as
  `FA` in the capacity pill and show that quota's own reset icon/time when supplied; never fabricate either value, borrow
  another window's reset, or add it to another provider. FloatBar never renders Pace pills or signed Pace percentages;
  Pace remains available in the tray dashboard, pop-out dashboard, provider details, history, and predictive warnings.
  Right-align all vertical pills. While click-through is enabled, omit the drag grip and use native cursor bounds detection to
  fade the bar to 10% opacity without removing its input-transparent Windows style.
- Use `CODEXBAR_PROOF_NO_ACTIVATE=1` only with `CODEXBAR_PROOF_MODE` for passive live capture; it must apply the native
  no-activate style before showing a proof surface and must not alter ordinary window-focus behavior. With a tray-panel
  proof, `CODEXBAR_PROOF_X_NOTIFICATIONS_OPEN=1` may open the X panel for capture and must have no effect outside proof mode.
- Keep automatic update download and install-on-quit disabled on the locally customized installed build. Manual
  upstream updates require re-porting and re-verifying these UI contracts before installation. Do not expose check,
  download, install, or retry update controls; Settings links to `https://github.com/steipete/CodexBar` for watching.
- The tray-opened CodexBar dashboard owns the persisted X watchlist for `@thsottiaux`, `@OpenAI`, and `@sama`;
  never render its bell or list on the FloatBar. Poll the public profile and official X syndication payloads so authored
  posts, replies, and reposts are all discoverable; use `/with_replies` and local browser cookies only as fallbacks,
  and never log or persist cookie headers. Maintain a timestamped rolling seven-day notified ledger: every discovered
  item inside that window that is absent from the ledger becomes unread exactly once, and older ledger/unread entries
  are pruned. Legacy untimestamped seen IDs must not suppress missed notifications. Open unread items at their exact X
  status URL.
- Keep `MenuCard.tsx` and `TrayPanel.tsx` as composition roots. Pure display derivation, bridge loading, provider-view
  state, and native window behavior belong in their focused modules under the indexed child boundaries.
- Native tests must not rewrite the user's real startup registration. Start-at-login repair may run only from a
  recognized shipped CodexBar executable name.
- Prefer Windows-native validation for tray/DPAPI/browser-cookie behavior; WSL/Linux can be insufficient for those paths.

## Child DOX Index
- `apps/desktop-tauri/src/components/menu-card/AGENTS.md` — usage-card presentation and data-loading contracts.
- `apps/desktop-tauri/src/surfaces/tray/AGENTS.md` — tray state, controls, and native-window lifecycle contracts.
- `apps/desktop-tauri/src/floatbar/AGENTS.md` — detached FloatBar presentation, native lifecycle, and Windows overlay contracts.
