pub(crate) mod activity;
mod activity_format;
mod capture_types;
mod conversation;
mod error;
mod events;
mod model;
pub(crate) mod permission;
mod providers;
mod runtime;
#[cfg(test)]
mod tests;

pub use activity::{ActivityDetails, ActivityKind};
pub use capture_types::CapturedImage;
#[cfg(windows)]
pub use capture_types::CapturedImageOutcome;
#[cfg(windows)]
pub(crate) use capture_types::{
    CaptureReservation, capture_text_with_deadline, capture_with_deadline,
};
pub(crate) use conversation::ConversationSummary;
#[cfg(test)]
pub(crate) use model::default_workspace_path;
pub use model::{
    AcceptedRun, CaptureSnapshot, ChatMessage, Control, ModelOption, ProviderId, ProviderRateLimit,
    ProviderReadiness, RunPhase, Snapshot, StagedCaptureSnapshot, UsageSnapshot,
};
pub(crate) use model::{
    MARKER_CLEAR_NOTICE, MAX_ASSISTANT_TEXT, ModelSelection, mutate, resolve_workspace_path,
};
pub use permission::{PendingPermissionSnapshot, PermissionDecision};
pub use providers::catalog::ProviderDescriptor;
#[cfg(test)]
pub use runtime::LearningMode;
pub use runtime::{AgentRuntime, AssistantProfile, TurnOptions};
