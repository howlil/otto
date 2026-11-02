use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentError {
    InvalidRequest(String),
    ProviderUnavailable(String),
    ReadinessFailed(String),
    Cancelled(String),
    PersistenceFailed(String),
    Internal(String),
}

impl AgentError {
    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::InvalidRequest(message.into())
    }

    pub fn provider_unavailable(message: impl Into<String>) -> Self {
        Self::ProviderUnavailable(message.into())
    }

    pub fn readiness_failed(message: impl Into<String>) -> Self {
        Self::ReadinessFailed(message.into())
    }

    pub fn cancelled(message: impl Into<String>) -> Self {
        Self::Cancelled(message.into())
    }

    pub fn persistence_failed(message: impl Into<String>) -> Self {
        Self::PersistenceFailed(message.into())
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }

    pub fn message(&self) -> &str {
        match self {
            Self::InvalidRequest(message)
            | Self::ProviderUnavailable(message)
            | Self::ReadinessFailed(message)
            | Self::Cancelled(message)
            | Self::PersistenceFailed(message)
            | Self::Internal(message) => message,
        }
    }
}

impl fmt::Display for AgentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl From<AgentError> for String {
    fn from(error: AgentError) -> Self {
        error.message().to_owned()
    }
}

impl From<AgentError> for std::io::Error {
    fn from(error: AgentError) -> Self {
        std::io::Error::other(error.message().to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_message_matches_safe_ui_strings_without_internal_detail() {
        assert_eq!(
            AgentError::invalid_request("Unknown provider.").to_string(),
            "Unknown provider."
        );
        assert_eq!(
            AgentError::persistence_failed("History could not be saved.").to_string(),
            "History could not be saved."
        );
        assert_eq!(
            AgentError::cancelled("Readiness probe cancelled.").to_string(),
            "Readiness probe cancelled."
        );
        assert_eq!(
            String::from(AgentError::internal("Conversation history is unavailable.")),
            "Conversation history is unavailable."
        );
    }

    #[test]
    fn variants_carry_their_semantics() {
        let readiness = AgentError::readiness_failed("Provider not signed in.");
        assert!(matches!(readiness, AgentError::ReadinessFailed(_)));
        let unavailable = AgentError::provider_unavailable("Agent is busy. Try again.");
        assert!(matches!(
            unavailable,
            AgentError::ProviderUnavailable(message) if message.contains("busy")
        ));
    }
}
