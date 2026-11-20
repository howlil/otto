use std::{collections::HashSet, ffi::OsString, path::PathBuf, sync::RwLock};

static EFFECTIVE_PATH: RwLock<Option<OsString>> = RwLock::new(None);

pub(in crate::agent::providers) fn effective_path() -> Option<OsString> {
    if let Ok(guard) = EFFECTIVE_PATH.read()
        && let Some(refreshed) = guard.as_ref()
    {
        return Some(refreshed.clone());
    }
    std::env::var_os("PATH")
}

pub(in crate::agent::providers) fn refreshed_path_override() -> Option<OsString> {
    EFFECTIVE_PATH.read().ok().and_then(|guard| guard.clone())
}

pub(in crate::agent::providers) fn find_executable(names: &[&str]) -> Option<PathBuf> {
    let path = effective_path()?;
    for dir in std::env::split_paths(&path) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

pub(in crate::agent) fn refresh_live_path() -> usize {
    let mut sources = Vec::new();
    #[cfg(windows)]
    {
        if let Some(system_path) = read_windows_registry_path(true) {
            sources.push(system_path);
        }
        if let Some(user_path) = read_windows_registry_path(false) {
            sources.push(user_path);
        }
    }
    if let Some(process_path) = std::env::var_os("PATH") {
        sources.push(process_path);
    }
    let (merged, count) = merge_path_entries(&sources);
    if count > 0
        && let Ok(mut guard) = EFFECTIVE_PATH.write()
    {
        *guard = Some(merged);
    }
    count
}

fn merge_path_entries(sources: &[OsString]) -> (OsString, usize) {
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for source in sources {
        for path in std::env::split_paths(source) {
            let raw = path.to_string_lossy();
            let trimmed = raw.trim().trim_end_matches(['\\', '/']);
            if trimmed.is_empty() {
                continue;
            }
            let key = if cfg!(windows) {
                trimmed.to_ascii_lowercase()
            } else {
                trimmed.to_owned()
            };
            if seen.insert(key) {
                entries.push(path);
            }
        }
    }
    let count = entries.len();
    let joined = std::env::join_paths(entries).unwrap_or_default();
    (joined, count)
}

#[cfg(windows)]
fn read_windows_registry_path(machine: bool) -> Option<OsString> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ, RegGetValueW,
    };

    let root = if machine {
        HKEY_LOCAL_MACHINE
    } else {
        HKEY_CURRENT_USER
    };
    let subkey = if machine {
        "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"
    } else {
        "Environment"
    };
    let subkey_wide: Vec<u16> = std::ffi::OsStr::new(subkey)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let value_wide: Vec<u16> = std::ffi::OsStr::new("Path")
        .encode_wide()
        .chain(Some(0))
        .collect();
    let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;
    let mut bytes = 0u32;
    let size_status = unsafe {
        RegGetValueW(
            root,
            subkey_wide.as_ptr(),
            value_wide.as_ptr(),
            flags,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut bytes,
        )
    };
    if size_status != ERROR_SUCCESS || !(2..=1024 * 1024).contains(&bytes) {
        return None;
    }
    let mut buf = vec![0u16; (bytes as usize).div_ceil(2)];
    let mut actual_bytes = (buf.len() * 2) as u32;
    let read_status = unsafe {
        RegGetValueW(
            root,
            subkey_wide.as_ptr(),
            value_wide.as_ptr(),
            flags,
            std::ptr::null_mut(),
            buf.as_mut_ptr().cast(),
            &mut actual_bytes,
        )
    };
    if read_status != ERROR_SUCCESS {
        return None;
    }
    let len = buf.iter().position(|&unit| unit == 0).unwrap_or(buf.len());
    Some(OsString::from_wide(&buf[..len]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_path_entries_preserves_order_and_deduplicates_entries() {
        let sep = if cfg!(windows) { ";" } else { ":" };
        let system = OsString::from(format!("C:\\Windows\\System32{sep}C:\\Tools\\"));
        let user = OsString::from(format!("c:\\tools{sep}C:\\Users\\demo\\.local\\bin{sep} "));
        let (merged, count) = merge_path_entries(&[system, user]);
        let parts: Vec<PathBuf> = std::env::split_paths(&merged).collect();
        if cfg!(windows) {
            assert_eq!(count, 3);
            assert_eq!(parts[0], PathBuf::from("C:\\Windows\\System32"));
            assert_eq!(parts[1], PathBuf::from("C:\\Tools\\"));
            assert_eq!(parts[2], PathBuf::from("C:\\Users\\demo\\.local\\bin"));
        } else {
            assert!(count >= 3);
        }
    }
}
