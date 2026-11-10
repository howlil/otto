use crate::agent::{AgentRuntime, RunPhase};
use std::time::Duration;
use tokio::time::timeout;

async fn wait_for(runtime: &AgentRuntime, phase: RunPhase) {
    let mut updates = runtime.updates.subscribe();
    timeout(Duration::from_secs(180), async {
        loop {
            let snapshot = updates.borrow_and_update().clone();
            if snapshot.status == phase {
                return;
            }
            assert_ne!(
                snapshot.status,
                RunPhase::Failed,
                "{}",
                snapshot.error.as_deref().unwrap_or("Provider failed.")
            );
            updates.changed().await.unwrap();
        }
    })
    .await
    .expect("Installed provider did not reach the expected phase.");
}

async fn conversation_and_stop(provider: &str) {
    let runtime = AgentRuntime::new();
    runtime.select_provider(provider.into()).await.unwrap();
    let ready = runtime.provider_readiness(provider, None).await;
    assert_eq!(
        ready.status, "ready",
        "{} {}",
        ready.message, ready.recovery
    );
    println!(
        "Native acceptance provider: {provider}; model: {}",
        ready.model.as_deref().unwrap_or("default")
    );
    let conversation = runtime.snapshot().conversation_id;
    runtime
        .ask(
            "Remember the harmless marker OTTO_CONTEXT_41. Reply only ACK.".into(),
            provider.into(),
            ready.model.clone(),
            None,
        )
        .await
        .unwrap();
    wait_for(&runtime, RunPhase::Completed).await;
    runtime
        .ask(
            "Repeat only the marker from my previous message.".into(),
            provider.into(),
            ready.model.clone(),
            None,
        )
        .await
        .unwrap();
    wait_for(&runtime, RunPhase::Completed).await;
    let snapshot = runtime.snapshot();
    assert_eq!(snapshot.conversation_id, conversation);
    assert_eq!(
        snapshot
            .messages
            .iter()
            .filter(|message| message.role == "user")
            .count(),
        2
    );
    assert!(
        snapshot
            .messages
            .last()
            .unwrap()
            .text
            .contains("OTTO_CONTEXT_41")
    );
    runtime
        .ask(
            "List the integers from 1 to 10000, each on its own line.".into(),
            provider.into(),
            ready.model,
            None,
        )
        .await
        .unwrap();
    wait_for(&runtime, RunPhase::Streaming).await;
    runtime.stop().await.unwrap();
    wait_for(&runtime, RunPhase::Stopped).await;
    assert_eq!(runtime.snapshot().conversation_id, conversation);
    runtime.new_session().await.unwrap();
    assert!(runtime.snapshot().messages.is_empty());
}

#[tokio::test]
#[ignore = "requires working model quota; sends two small live prompts and cancels a third through installed Pi"]
async fn installed_pi_conversation_followup_and_stop() {
    conversation_and_stop("pi").await;
}

#[tokio::test]
#[ignore = "requires working model quota; sends two small live prompts and cancels a third through installed OpenCode"]
async fn installed_opencode_conversation_followup_and_stop() {
    conversation_and_stop("opencode").await;
}

#[tokio::test]
#[ignore = "starts and immediately cancels one live turn per installed CLI"]
async fn installed_cli_stop_allows_immediate_new_chat() {
    for (provider, streaming) in [
        ("pi", false),
        ("pi", true),
        ("opencode", false),
        ("opencode", true),
    ] {
        let runtime = AgentRuntime::new();
        runtime.select_provider(provider.into()).await.unwrap();
        runtime
            .ask("Reply only ACK.".into(), provider.into(), None, None)
            .await
            .unwrap();
        if streaming {
            wait_for(&runtime, RunPhase::Streaming).await;
        }
        runtime.stop().await.unwrap();
        wait_for(&runtime, RunPhase::Stopped).await;
        runtime.new_session().await.unwrap();
        assert!(runtime.snapshot().messages.is_empty());
        println!(
            "{provider}: Stop followed immediately by New Chat passed; streaming={streaming}."
        );
    }
}
