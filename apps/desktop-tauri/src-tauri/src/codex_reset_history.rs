//! Tauri bridge for the persisted Codex reset-credit history.

use chrono::Utc;
use codexbar::{
    codex_reset_history::{CodexResetHistorySnapshot, CodexResetHistoryStore},
    providers::codex::CodexApi,
};

#[tauri::command]
pub async fn get_codex_reset_history() -> Result<CodexResetHistorySnapshot, String> {
    let store = CodexResetHistoryStore::from_settings()?;
    let now = Utc::now();
    match CodexApi::new().fetch_reset_credit_entries().await {
        Ok(credits) => store.merge_banked(&credits, now),
        Err(error) => {
            tracing::warn!("Could not refresh Codex reset-credit history: {error}");
            store.snapshot(now, true)
        }
    }
}
