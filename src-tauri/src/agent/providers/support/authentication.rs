pub(in crate::agent::providers) fn authentication_required(detail: &str) -> bool {
    let detail = detail.to_ascii_lowercase();
    [
        "sign in",
        "sign-in",
        "not signed in",
        "log in",
        "login",
        "not authenticated",
        "authentication required",
        "unauthorized",
        "invalid credentials",
        "expired credentials",
        "token expired",
    ]
    .iter()
    .any(|signal| detail.contains(signal))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_signals_are_recognized_from_provider_detail() {
        assert!(authentication_required("401 Unauthorized: token expired"));
        assert!(authentication_required("Please log in again"));
        assert!(!authentication_required("rate limit reached"));
        assert!(!authentication_required(""));
    }
}
