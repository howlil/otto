use crate::agent::{
    AcceptedRun, AgentRuntime, AssistantProfile, ProviderDescriptor, RunPhase, RuntimePrefs,
    Snapshot, TurnOptions,
};
use std::{
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{State, ipc::Channel};
use tokio::sync::{oneshot, watch};

pub(crate) fn start_recovery_observer(runtime: &AgentRuntime) {
    if let Some(observer) = runtime.recovery_observer() {
        tauri::async_runtime::spawn(observer);
    }
}

#[derive(Default)]
pub struct AgentSubscriptions {
    next_id: AtomicU64,
    active: Mutex<Option<(u64, oneshot::Sender<()>)>>,
}

impl AgentSubscriptions {
    fn subscribe(&self, mut updates: watch::Receiver<Snapshot>, channel: Channel<Snapshot>) -> u64 {
        let subscription_id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (cancel_tx, mut cancel_rx) = oneshot::channel();
        let previous = self
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .replace((subscription_id, cancel_tx));
        if let Some((_, previous)) = previous {
            let _ = previous.send(());
        }
        tauri::async_runtime::spawn(async move {
            if channel.send(updates.borrow_and_update().clone()).is_err() {
                return;
            }
            let min_interval = Duration::from_millis(32);
            let mut last_sent: Option<Instant> = None;
            loop {
                tokio::select! {
                    _ = &mut cancel_rx => break,
                    changed = updates.changed() => {
                        if changed.is_err() {
                            break;
                        }
                        let immediate = {
                            let state = updates.borrow();
                            !matches!(state.status, RunPhase::Streaming)
                                || state.pending_permission.is_some()
                                || last_sent.is_none_or(|ts| ts.elapsed() >= min_interval)
                        };
                        if !immediate
                            && let Some(ts) = last_sent
                            && let Some(wait) = min_interval.checked_sub(ts.elapsed())
                        {
                            tokio::select! {
                                _ = &mut cancel_rx => break,
                                _ = tokio::time::sleep(wait) => {}
                            }
                        }
                        let snapshot = updates.borrow_and_update().clone();
                        last_sent = Some(Instant::now());
                        if channel.send(snapshot).is_err() {
                            break;
                        }
                    }
                }
            }
        });
        subscription_id
    }

    fn unsubscribe(&self, subscription_id: u64) {
        let cancel = {
            let mut active = self
                .active
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if active
                .as_ref()
                .is_some_and(|(active_id, _)| *active_id == subscription_id)
            {
                active.take().map(|(_, cancel)| cancel)
            } else {
                None
            }
        };
        if let Some(cancel) = cancel {
            let _ = cancel.send(());
        }
    }
}

#[tauri::command]
pub fn agent_snapshot(runtime: State<'_, AgentRuntime>) -> Snapshot {
    runtime.snapshot()
}
#[tauri::command]
pub fn agent_history_list(
    runtime: State<'_, AgentRuntime>,
    query: Option<String>,
) -> Result<Vec<crate::agent::ConversationSummary>, String> {
    runtime.history_list(query.as_deref())
}
#[tauri::command]
pub fn agent_history_export_markdown(
    runtime: State<'_, AgentRuntime>,
    conversation_id: String,
) -> Result<String, String> {
    runtime.history_export_markdown(&conversation_id)
}
#[tauri::command]
pub async fn agent_history_open(
    runtime: State<'_, AgentRuntime>,
    conversation_id: String,
) -> Result<Snapshot, String> {
    runtime.history_open(&conversation_id).await
}
#[tauri::command]
pub fn agent_history_rename(
    runtime: State<'_, AgentRuntime>,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    runtime.history_rename(&conversation_id, &title)
}
#[tauri::command]
pub async fn agent_history_delete(
    runtime: State<'_, AgentRuntime>,
    conversation_id: String,
) -> Result<(), String> {
    runtime.history_delete(&conversation_id).await
}
#[tauri::command]
pub async fn agent_history_delete_all(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.history_delete_all().await
}
#[tauri::command]
pub fn agent_provider_catalog(runtime: State<'_, AgentRuntime>) -> Vec<ProviderDescriptor> {
    runtime.provider_catalog()
}

#[tauri::command]
pub fn agent_refresh_provider_catalog(runtime: State<'_, AgentRuntime>) -> Vec<ProviderDescriptor> {
    runtime.refresh_provider_catalog()
}

#[tauri::command]
pub async fn agent_provider_readiness(
    runtime: State<'_, AgentRuntime>,
    provider: String,
    model: Option<String>,
    request_id: u64,
    force: Option<bool>,
) -> Result<crate::agent::ProviderReadiness, String> {
    runtime
        .probe_provider_readiness(
            request_id,
            &provider,
            None,
            model.as_deref(),
            force.unwrap_or(false),
        )
        .await
}

#[tauri::command]
pub fn agent_runtime_prefs(runtime: State<'_, AgentRuntime>) -> RuntimePrefs {
    runtime.runtime_prefs()
}

#[tauri::command]
pub fn agent_toggle_pinned_model(
    runtime: State<'_, AgentRuntime>,
    provider: String,
    model_id: String,
) -> Result<Vec<String>, String> {
    runtime.toggle_pinned_model(provider, model_id)
}

#[tauri::command]
pub fn agent_cancel_provider_readiness(runtime: State<'_, AgentRuntime>, request_id: u64) {
    runtime.cancel_provider_readiness(request_id);
}

#[tauri::command]
pub async fn agent_select_runtime_options(
    runtime: State<'_, AgentRuntime>,
    model: Option<String>,
    thinking_effort: Option<String>,
) -> Result<(), String> {
    runtime.select_runtime_options(model, thinking_effort).await
}

#[tauri::command]
pub async fn agent_select_provider(
    runtime: State<'_, AgentRuntime>,
    provider: String,
) -> Result<(), String> {
    runtime.select_provider(provider).await
}

#[tauri::command]
pub async fn agent_warm_provider(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.warm_active_provider().await;
    Ok(())
}

#[tauri::command]
pub fn agent_subscribe(
    runtime: State<'_, AgentRuntime>,
    subscriptions: State<'_, AgentSubscriptions>,
    on_event: Channel<Snapshot>,
) -> u64 {
    subscriptions.subscribe(runtime.subscribe_updates(), on_event)
}
#[tauri::command]
pub fn agent_unsubscribe(subscriptions: State<'_, AgentSubscriptions>, subscription_id: u64) {
    subscriptions.unsubscribe(subscription_id);
}
#[tauri::command]
pub async fn agent_ask(
    runtime: State<'_, AgentRuntime>,
    text: String,
    provider: String,
    model: Option<String>,
    thinking_effort: Option<String>,
    mode: Option<String>,
    profile: Option<AssistantProfile>,
) -> Result<AcceptedRun, String> {
    runtime
        .ask_with_guidance(text, provider, model, thinking_effort, mode, profile)
        .await
}

#[tauri::command]
pub fn agent_set_guidance(
    runtime: State<'_, AgentRuntime>,
    mode: Option<String>,
    profile: Option<AssistantProfile>,
) -> Result<(), String> {
    runtime.set_guidance(mode, profile)
}

#[tauri::command]
pub async fn agent_stop(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.stop().await
}

#[tauri::command]
pub async fn agent_new_chat(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.new_session().await
}

#[tauri::command]
pub async fn agent_retry_last(
    runtime: State<'_, AgentRuntime>,
    provider: String,
    model: Option<String>,
    thinking_effort: Option<String>,
    mode: Option<String>,
    profile: Option<AssistantProfile>,
) -> Result<AcceptedRun, String> {
    runtime
        .retry_last_turn(provider, model, thinking_effort, mode, profile)
        .await
}

#[tauri::command]
pub async fn agent_edit_and_rerun(
    runtime: State<'_, AgentRuntime>,
    message_id: String,
    text: String,
    options: TurnOptions,
) -> Result<AcceptedRun, String> {
    runtime.edit_and_rerun(message_id, text, options).await
}

#[tauri::command]
pub fn agent_queue_followup(
    runtime: State<'_, AgentRuntime>,
    text: String,
    provider: String,
    model: Option<String>,
    thinking_effort: Option<String>,
    mode: Option<String>,
    profile: Option<AssistantProfile>,
) -> Result<String, String> {
    runtime.queue_followup(text, provider, model, thinking_effort, mode, profile)
}

#[tauri::command]
pub fn agent_clear_queued_followup(runtime: State<'_, AgentRuntime>) -> Option<String> {
    runtime.clear_queued_followup()
}

#[tauri::command]
pub async fn agent_respond_permission(
    runtime: State<'_, AgentRuntime>,
    request_id: String,
    allow: bool,
) -> Result<(), String> {
    runtime.respond_permission(request_id, allow).await
}
