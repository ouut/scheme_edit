use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use tracing::{error, info};

use crate::AppState;

#[derive(Debug, Deserialize, Default)]
pub struct TerminalQuery {
    pub tab_id: Option<String>,
    pub cmd: Option<String>,
}

/// Locate the scheme-ide executable path
pub fn find_scheme_ide_binary() -> Option<PathBuf> {
    if let Ok(bin) = std::env::var("SCHEME_IDE_BIN") {
        let p = PathBuf::from(bin);
        if p.exists() {
            return Some(p);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let name = exe.file_name().and_then(|f| f.to_str()).unwrap_or("");
        let is_deps = exe.to_string_lossy().contains("deps");
        if !is_deps && (name == "scheme-ide" || name == "scheme-ide.exe") {
            return Some(exe);
        }
    }

    let candidates = [
        PathBuf::from("/workspace/scheme_edit/server/target/debug/scheme-ide"),
        PathBuf::from("/workspace/scheme_edit/server/target/release/scheme-ide"),
        PathBuf::from("/workspace/scheme_edit/scheme-ide"),
        PathBuf::from("./scheme-ide"),
        PathBuf::from("scheme-ide"),
    ];

    for cand in candidates {
        if cand.exists() {
            if let Ok(canon) = cand.canonicalize() {
                return Some(canon);
            }
            return Some(cand);
        }
    }

    if let Ok(p) = which::which(if cfg!(windows) { "scheme-ide.exe" } else { "scheme-ide" }) {
        return Some(p);
    }

    None
}

/// Normalize path by collapsing `.` and `..` without requiring file existence
pub fn normalize_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut components = Vec::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(components.last(), Some(Component::Normal(_))) {
                    components.pop();
                } else {
                    components.push(comp);
                }
            }
            _ => components.push(comp),
        }
    }
    components.into_iter().collect()
}

/// Send HTTP POST /api/gui using standard Tokio TcpStream
pub async fn send_gui_http(port: u16, payload: &serde_json::Value) -> Result<(), anyhow::Error> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let body = serde_json::to_string(payload)?;
    let request = format!(
        "POST /api/gui HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        port,
        body.len(),
        body
    );

    let mut stream = TcpStream::connect(("127.0.0.1", port)).await?;
    stream.write_all(request.as_bytes()).await?;
    stream.flush().await?;

    let mut response = Vec::new();
    let _ = stream.read_to_end(&mut response).await;
    Ok(())
}

/// Run GUI CLI command (`gui open [file]`, `gui edit [file]`, `gui close [file]`, `gui ratio <L:R>`, etc.)
pub async fn run_gui_cli(args: &[String]) {
    let port = std::env::var("SCHEME_IDE_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8085);

    let subcmd = args.first().map(|s| s.trim()).unwrap_or("help");

    match subcmd {
        "open" | "edit" => {
            let file_arg = args.get(1).map(|s| s.trim()).unwrap_or("");
            let resolved_file = if file_arg.is_empty() {
                "".to_string()
            } else {
                let p = Path::new(file_arg);
                let full = if p.is_absolute() {
                    p.to_path_buf()
                } else if let Ok(cwd) = std::env::current_dir() {
                    cwd.join(p)
                } else {
                    p.to_path_buf()
                };
                normalize_path(&full).to_string_lossy().to_string()
            };

            let cwd_str = std::env::current_dir()
                .ok()
                .map(|p| normalize_path(&p).to_string_lossy().to_string());

            let payload = serde_json::json!({
                "cmd": "open",
                "file": resolved_file,
                "cwd": cwd_str
            });

            if let Err(e) = send_gui_http(port, &payload).await {
                eprintln!("\x1b[31m[GUI Error]\x1b[0m Failed to connect to Scheme IDE on port {port}: {e}");
            } else {
                let display_file = if resolved_file.is_empty() {
                    "scratch-*.scm"
                } else {
                    &resolved_file
                };
                println!("\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: open {}", display_file);
            }
        }
        "cd" => {
            let dir_arg = args.get(1).map(|s| s.trim()).unwrap_or("");
            let resolved_dir = if dir_arg.is_empty() {
                if let Ok(cwd) = std::env::current_dir() {
                    cwd.to_string_lossy().to_string()
                } else {
                    ".".to_string()
                }
            } else {
                let p = Path::new(dir_arg);
                let full = if p.is_absolute() {
                    p.to_path_buf()
                } else if let Ok(cwd) = std::env::current_dir() {
                    cwd.join(p)
                } else {
                    p.to_path_buf()
                };
                normalize_path(&full).to_string_lossy().to_string()
            };

            let payload = serde_json::json!({
                "cmd": "cd",
                "dir": resolved_dir,
                "cwd": resolved_dir
            });

            if let Err(e) = send_gui_http(port, &payload).await {
                eprintln!("\x1b[31m[GUI Error]\x1b[0m Failed to connect to Scheme IDE on port {port}: {e}");
            } else {
                println!("\x1b[38;2;56;189;248m[GUI]\x1b[0m Working directory set: {}", resolved_dir);
            }
        }
        "close" => {
            let file_arg = args.get(1).map(|s| s.trim()).unwrap_or("");
            let payload = serde_json::json!({
                "cmd": "close",
                "file": file_arg
            });

            if let Err(e) = send_gui_http(port, &payload).await {
                eprintln!("\x1b[31m[GUI Error]\x1b[0m Failed to connect to Scheme IDE on port {port}: {e}");
            } else if file_arg.is_empty() {
                println!("\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: close");
            } else {
                println!("\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: close {}", file_arg);
            }
        }
        "ratio" => {
            let ratio_arg = args.get(1).map(|s| s.trim()).unwrap_or("50:50");
            let payload = serde_json::json!({
                "cmd": "ratio",
                "args": [ratio_arg]
            });

            if let Err(e) = send_gui_http(port, &payload).await {
                eprintln!("\x1b[31m[GUI Error]\x1b[0m Failed to connect to Scheme IDE on port {port}: {e}");
            } else {
                println!("\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: ratio {}", ratio_arg);
            }
        }
        "help" | "--help" | "-h" | "" => {
            println!(
                "\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: help\r\n\
                 \x20 gui open [file]   - Open file in editor (defaults to scratch-*.scm)\r\n\
                 \x20 gui edit [file]   - Open file in editor (defaults to scratch-*.scm)\r\n\
                 \x20 gui close [file]  - Close current or specified file\r\n\
                 \x20 gui cd [dir]      - Change working directory\r\n\
                 \x20 gui ratio <L:R>   - Adjust editor/terminal ratio (e.g. 60:40)\r\n\
                 \x20 gui help          - Show this help message"
            );
        }
        other => {
            println!(
                "\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: unknown command '{}' (type 'gui help' for commands)",
                other
            );
        }
    }
}

/// Ensure a directory containing the `gui` executable/wrapper exists and is ready to be prepended to PATH
pub fn ensure_gui_helper_bin() -> Result<PathBuf, anyhow::Error> {
    let helper_dir = std::env::temp_dir().join("scheme-ide-bin");
    std::fs::create_dir_all(&helper_dir)?;

    let scheme_ide_candidate = find_scheme_ide_binary()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let script_path = helper_dir.join("gui");
        let script_content = format!(
            r#"#!/bin/sh
PORT="${{SCHEME_IDE_PORT:-8085}}"
CAND="{}"

if [ -n "$SCHEME_IDE_BIN" ] && [ -x "$SCHEME_IDE_BIN" ]; then
    exec "$SCHEME_IDE_BIN" gui "$@"
fi

if [ -n "$CAND" ] && [ -x "$CAND" ]; then
    exec "$CAND" gui "$@"
fi

if command -v scheme-ide >/dev/null 2>&1; then
    exec scheme-ide gui "$@"
fi

# Fallback using curl if scheme-ide binary is not immediately found
cmd="${{1:-help}}"
shift 2>/dev/null || true
case "$cmd" in
    open|edit)
        target="$1"
        if [ -z "$target" ]; then
            target=""
        else
            case "$target" in
                /*) resolved="$target" ;;
                *) resolved="$(pwd)/$target" ;;
            esac
            target="$resolved"
        fi
        if command -v curl >/dev/null 2>&1; then
            curl -s -X POST "http://127.0.0.1:$PORT/api/gui" \
                -H "Content-Type: application/json" \
                -d "{{\"cmd\":\"open\",\"file\":\"$target\"}}" >/dev/null 2>&1 || true
        fi
        printf "\033[38;2;56;189;248m[GUI]\033[0m Action: open %s\n" "$target"
        ;;
    close)
        target="$1"
        if command -v curl >/dev/null 2>&1; then
            curl -s -X POST "http://127.0.0.1:$PORT/api/gui" \
                -H "Content-Type: application/json" \
                -d "{{\"cmd\":\"close\",\"file\":\"$target\"}}" >/dev/null 2>&1 || true
        fi
        if [ -n "$target" ]; then
            printf "\033[38;2;56;189;248m[GUI]\033[0m Action: close %s\n" "$target"
        else
            printf "\033[38;2;56;189;248m[GUI]\033[0m Action: close\n"
        fi
        ;;
    ratio)
        ratio="$1"
        if command -v curl >/dev/null 2>&1; then
            curl -s -X POST "http://127.0.0.1:$PORT/api/gui" \
                -H "Content-Type: application/json" \
                -d "{{\"cmd\":\"ratio\",\"args\":[\"$ratio\"]}}" >/dev/null 2>&1 || true
        fi
        printf "\033[38;2;56;189;248m[GUI]\033[0m Action: ratio %s\n" "$ratio"
        ;;
    help|--help|-h)
        printf "\033[38;2;56;189;248m[GUI]\033[0m Action: help\n"
        printf "  gui open [file]   - Open file in editor (defaults to scratch-*.scm)\n"
        printf "  gui edit [file]   - Open file in editor (defaults to scratch-*.scm)\n"
        printf "  gui close [file]  - Close current or specified file\n"
        printf "  gui ratio <L:R>   - Adjust editor/terminal ratio (e.g. 60:40)\n"
        printf "  gui help          - Show this help message\n"
        ;;
    *)
        printf "\033[38;2;56;189;248m[GUI]\033[0m Action: unknown command '%s' (type 'gui help' for commands)\n" "$cmd"
        ;;
esac
"#,
            scheme_ide_candidate
        );
        let _ = std::fs::write(&script_path, &script_content);
        let _ = std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755));

        // Also try writing /usr/local/bin/gui if writable
        let usr_local_bin = Path::new("/usr/local/bin/gui");
        if !usr_local_bin.exists() {
            let _ = std::fs::copy(&script_path, usr_local_bin);
            let _ = std::fs::set_permissions(usr_local_bin, std::fs::Permissions::from_mode(0o755));
        }

        // Also ensure `scheme-ide` binary is directly accessible in helper_dir and /usr/local/bin
        if !scheme_ide_candidate.is_empty() {
            let ide_link = helper_dir.join("scheme-ide");
            if !ide_link.exists() {
                let _ = std::os::unix::fs::symlink(Path::new(&scheme_ide_candidate), &ide_link);
            }
            let usr_ide = Path::new("/usr/local/bin/scheme-ide");
            if !usr_ide.exists() {
                let _ = std::os::unix::fs::symlink(Path::new(&scheme_ide_candidate), usr_ide);
            }
        }
    }

    #[cfg(windows)]
    {
        let bat_path = helper_dir.join("gui.bat");
        let cmd_path = helper_dir.join("gui.cmd");
        let bat_content = format!(
            r#"@echo off
setlocal
if defined SCHEME_IDE_BIN (
    "%SCHEME_IDE_BIN%" gui %*
    exit /b %ERRORLEVEL%
)
if exist "{}" (
    "{}" gui %*
    exit /b %ERRORLEVEL%
)
where scheme-ide >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    scheme-ide gui %*
    exit /b %ERRORLEVEL%
)
echo [GUI Error] Cannot find scheme-ide.exe to execute gui command.
exit /b 1
"#,
            scheme_ide_candidate, scheme_ide_candidate
        );
        let _ = std::fs::write(&bat_path, &bat_content);
        let _ = std::fs::write(&cmd_path, &bat_content);

        let ide_bat = helper_dir.join("scheme-ide.bat");
        let ide_cmd = helper_dir.join("scheme-ide.cmd");
        let ide_bat_content = format!(
            r#"@echo off
setlocal
if exist "{}" (
    "{}" %*
    exit /b %ERRORLEVEL%
)
"#,
            scheme_ide_candidate, scheme_ide_candidate
        );
        let _ = std::fs::write(&ide_bat, &ide_bat_content);
        let _ = std::fs::write(&ide_cmd, &ide_bat_content);
    }

    Ok(helper_dir)
}

/// Get current working directory of a process by PID on Linux
pub fn get_process_cwd(pid: u32) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(link) = std::fs::read_link(format!("/proc/{}/cwd", pid)) {
            if link.exists() && link.is_dir() {
                return Some(link);
            }
        }
    }
    let _ = pid;
    None
}

/// Retrieve the active working directory, updating from the active terminal PID if available
pub async fn get_current_working_dir(state: &AppState) -> PathBuf {
    use std::sync::atomic::Ordering;
    let pid = state.active_terminal_pid.load(Ordering::Relaxed);
    if pid > 0 {
        if let Some(cwd) = get_process_cwd(pid) {
            let mut guard = state.current_dir.write().await;
            if *guard != cwd {
                *guard = cwd.clone();
            }
            return cwd;
        }
    }
    state.current_dir.read().await.clone()
}

/// Spawns a PTY pair with the specified command (cmd="steel" or cmd="bash")
pub fn spawn_pty(
    cmd_name: &str,
    steel_bin: &Path,
    workspace_dir: &Path,
    port: u16,
) -> Result<(Box<dyn MasterPty + Send>, Box<dyn portable_pty::Child + Send + Sync>), anyhow::Error> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let cmd = if cmd_name == "steel" {
        let (bin, is_self) = if steel_bin.exists() {
            let is_curr = std::env::current_exe()
                .map(|exe| exe == *steel_bin)
                .unwrap_or(false);
            (steel_bin.to_path_buf(), is_curr)
        } else if let Ok(which_steel) = which::which(if cfg!(windows) { "steel.exe" } else { "steel" }) {
            (which_steel, false)
        } else if Path::new("/root/.cargo/bin/steel").exists() {
            (PathBuf::from("/root/.cargo/bin/steel"), false)
        } else if let Ok(exe) = std::env::current_exe() {
            (exe, true)
        } else if cfg!(windows) {
            (PathBuf::from("steel.exe"), false)
        } else {
            (PathBuf::from("steel"), false)
        };
        let mut cb = CommandBuilder::new(bin);
        if is_self {
            cb.arg("--steel");
        }
        cb.cwd(workspace_dir);
        cb.env("TERM", "xterm-256color");
        cb.env("COLORTERM", "truecolor");
        cb
    } else {
        let shell_bin = if cfg!(windows) {
            if let Ok(comspec) = std::env::var("COMSPEC") {
                PathBuf::from(comspec)
            } else {
                PathBuf::from("cmd.exe")
            }
        } else if let Ok(shell) = std::env::var("SHELL").map(PathBuf::from) {
            if shell.exists() {
                shell
            } else if Path::new("/bin/bash").exists() {
                PathBuf::from("/bin/bash")
            } else if Path::new("/bin/zsh").exists() {
                PathBuf::from("/bin/zsh")
            } else {
                PathBuf::from("sh")
            }
        } else if Path::new("/bin/bash").exists() {
            PathBuf::from("/bin/bash")
        } else if Path::new("/bin/zsh").exists() {
            PathBuf::from("/bin/zsh")
        } else {
            PathBuf::from("sh")
        };
        let mut cb = CommandBuilder::new(shell_bin);
        cb.cwd(workspace_dir);
        cb.env("TERM", "xterm-256color");
        cb.env("COLORTERM", "truecolor");

        // Inject scheme-ide GUI CLI helper directory into PATH so `gui` works everywhere with tab completion
        if let Ok(helper_dir) = ensure_gui_helper_bin() {
            let current_path = std::env::var("PATH").unwrap_or_default();
            let path_sep = if cfg!(windows) { ";" } else { ":" };
            cb.env("PATH", format!("{}{}{}", helper_dir.display(), path_sep, current_path));
        }
        cb.env("SCHEME_IDE_PORT", port.to_string());
        cb
    };

    let child = pair.slave.spawn_command(cmd)?;
    Ok((pair.master, child))
}

pub fn find_next_scratch_file() -> String {
    let workspace = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| {
        let def = PathBuf::from("/workspace/scheme_edit");
        if def.exists() {
            def.to_string_lossy().to_string()
        } else {
            ".".to_string()
        }
    });
    let workspace_path = Path::new(&workspace);
    let mut n = 1;
    loop {
        let name = format!("scratch-{}.scm", n);
        let candidate = workspace_path.join(&name);
        if !candidate.exists() {
            return name;
        }
        n += 1;
        if n >= 1000 {
            return name;
        }
    }
}

/// Parse and handle an intercepted GUI command line (e.g. "gui open foo.scm")
/// Returns (formatted_terminal_feedback, optional_broadcast_json)
pub fn handle_gui_command(line: &str) -> (String, Option<serde_json::Value>) {
    let trimmed = line.trim();

    if trimmed == "gui" || trimmed == "gui help" {
        let feedback = concat!(
            "\r\n\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: help\r\n",
            "  gui open [file]   - Open file in editor (defaults to scratch-*.scm)\r\n",
            "  gui edit [file]   - Open file in editor (defaults to scratch-*.scm)\r\n",
            "  gui close [file]  - Close current or specified file\r\n",
            "  gui ratio <L:R>   - Adjust editor/terminal ratio (e.g. 60:40)\r\n",
            "  gui help          - Show this help message\r\n"
        ).to_string();
        return (feedback, None);
    }

    if trimmed == "gui open"
        || trimmed == "gui edit"
        || trimmed.starts_with("gui open ")
        || trimmed.starts_with("gui edit ")
        || trimmed.starts_with("gui open\t")
        || trimmed.starts_with("gui edit\t")
    {
        let rem = trimmed
            .strip_prefix("gui open")
            .or_else(|| trimmed.strip_prefix("gui edit"))
            .unwrap_or("")
            .trim();
        let file = rem.trim_matches(|c| c == '\'' || c == '"').to_string();

        let file = if file.is_empty() {
            find_next_scratch_file()
        } else {
            file
        };

        let feedback = format!("\r\n\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: open {}\r\n", file);
        let action = serde_json::json!({
            "type": "gui_action",
            "action": "open",
            "file": file
        });
        return (feedback, Some(action));
    }

    if trimmed.starts_with("gui close") {
        let rem = trimmed.strip_prefix("gui close").unwrap_or("").trim();
        let file = rem.trim_matches(|c| c == '\'' || c == '"').to_string();

        let feedback = if file.is_empty() {
            "\r\n\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: close\r\n".to_string()
        } else {
            format!("\r\n\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: close {}\r\n", file)
        };

        let action = serde_json::json!({
            "type": "gui_action",
            "action": "close",
            "file": file
        });
        return (feedback, Some(action));
    }

    if trimmed.starts_with("gui ratio") {
        let rem = trimmed.strip_prefix("gui ratio").unwrap_or("").trim();

        let ratio_opt = if let Some((l, r)) = rem.split_once(':').or_else(|| rem.split_once('/')) {
            Some((l, r))
        } else {
            let parts: Vec<&str> = rem.split_whitespace().collect();
            if parts.len() == 2 {
                Some((parts[0], parts[1]))
            } else {
                None
            }
        };

        let parsed = ratio_opt.and_then(|(l, r)| {
            let left = l.trim().parse::<u32>().ok()?;
            let right = r.trim().parse::<u32>().ok()?;
            Some((left, right))
        });

        return match parsed {
            Some((left, right)) => {
                let feedback = format!(
                    "\r\n\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: ratio {}:{}\r\n",
                    left, right
                );
                let action = serde_json::json!({
                    "type": "gui_action",
                    "action": "ratio",
                    "left": left,
                    "right": right
                });
                (feedback, Some(action))
            }
            None => {
                let feedback = "\r\n\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: invalid ratio format (expected L:R, e.g. 60:40)\r\n".to_string();
                (feedback, None)
            }
        };
    }

    let feedback = format!(
        "\r\n\x1b[38;2;56;189;248m[GUI]\x1b[0m Action: unknown command '{}' (type 'gui help' for commands)\r\n",
        trimmed
    );
    (feedback, None)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EscapeState {
    Normal,
    Esc,
    Csi,
    Osc,
}

/// Strip ANSI escape sequences and non-printable control characters from raw terminal line
pub fn strip_ansi_and_controls(input: &str) -> String {
    let mut result = String::new();
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if let Some(&next) = chars.peek() {
                if next == '[' {
                    chars.next();
                    // CSI parameter/intermediate bytes 0x20..=0x3F, final byte 0x40..=0x7E
                    while let Some(&ch) = chars.peek() {
                        chars.next();
                        if ('\x40'..='\x7e').contains(&ch) {
                            break;
                        }
                    }
                } else if next == ']' {
                    chars.next();
                    // OSC sequence terminated by BEL (0x07) or ST (\x1b\)
                    while let Some(&ch) = chars.peek() {
                        chars.next();
                        if ch == '\x07' {
                            break;
                        }
                        if ch == '\x1b' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                } else if ('\x40'..='\x5f').contains(&next) {
                    chars.next();
                }
            }
        } else if c == '\t' || (!c.is_control() && c != '\r' && c != '\n') {
            result.push(c);
        }
    }

    let trimmed = result.trim_start();
    // If there is any leftover naked terminal query response prefix like "1;1R" or "?1;0c" or ">0;10;0c"
    if let Some(rest) = strip_terminal_query_prefix(trimmed) {
        rest.to_string()
    } else {
        result
    }
}

fn strip_terminal_query_prefix(s: &str) -> Option<&str> {
    let mut idx = 0;
    let chars: Vec<char> = s.chars().collect();
    if chars.is_empty() {
        return None;
    }
    // Optional leading '?' or '>'
    if idx < chars.len() && (chars[idx] == '?' || chars[idx] == '>') {
        idx += 1;
    }
    let mut has_digit = false;
    while idx < chars.len() && (chars[idx].is_ascii_digit() || chars[idx] == ';') {
        has_digit = true;
        idx += 1;
    }
    if has_digit && idx < chars.len() && (chars[idx] == 'R' || chars[idx] == 'c') {
        let prefix_len: usize = chars[..=idx].iter().map(|c| c.len_utf8()).sum();
        return Some(&s[prefix_len..]);
    }
    None
}

/// Process terminal input stream from WebSocket to child PTY
pub async fn process_terminal_input(
    bytes: &[u8],
    pty_writer: &Arc<tokio::sync::Mutex<Box<dyn Write + Send>>>,
) {
    let mut writer = pty_writer.lock().await;
    let _ = writer.write_all(bytes);
    let _ = writer.flush();
}

/// WebSocket route handler: /ws/terminal?tab_id=<id>&cmd=<steel|bash>
pub async fn ws_terminal_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<TerminalQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_terminal_socket(socket, params, state))
}

async fn handle_terminal_socket(
    socket: WebSocket,
    params: TerminalQuery,
    state: Arc<AppState>,
) {
    let cmd_name = params.cmd.as_deref().unwrap_or("bash");
    let workspace_dir = get_current_working_dir(&state).await;

    info!(
        "Terminal session connected: tab_id={:?}, cmd={}, dir={:?}",
        params.tab_id, cmd_name, workspace_dir
    );

    let (pty_master, child) = match spawn_pty(cmd_name, &state.steel_bin, &workspace_dir, state.port) {
        Ok(res) => res,
        Err(e) => {
            error!("Failed to spawn PTY for cmd '{}': {e}", cmd_name);
            return;
        }
    };

    let child_pid = child.process_id();
    if let Some(pid) = child_pid {
        state.active_terminal_pid.store(pid, std::sync::atomic::Ordering::Relaxed);
    }

    let pty_reader = match pty_master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            error!("Failed to clone PTY reader: {e}");
            return;
        }
    };

    let pty_writer = match pty_master.take_writer() {
        Ok(w) => Arc::new(tokio::sync::Mutex::new(w)),
        Err(e) => {
            error!("Failed to take PTY writer: {e}");
            return;
        }
    };

    let pty_master = Arc::new(std::sync::Mutex::new(pty_master));
    let child = Arc::new(tokio::sync::Mutex::new(child));

    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx_to_ws, mut rx_to_ws) = tokio::sync::mpsc::channel::<Message>(256);

    // Forwarding task: tx_to_ws -> ws_sender
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = rx_to_ws.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // PTY Reader thread: reads raw terminal bytes from child and forwards to WebSocket
    let tx_pty_reader = tx_to_ws.clone();
    let reader_task = tokio::task::spawn_blocking(move || {
        let mut reader = pty_reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    if tx_pty_reader.blocking_send(Message::Binary(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
                Err(_) => break, // Process exited
            }
        }
    });

    // Broadcast receiver task: listens to GUI actions broadcasted by other sessions/endpoints
    let mut gui_rx = state.gui_broadcast.subscribe();
    let tx_gui_broadcast = tx_to_ws.clone();
    let broadcast_task = tokio::spawn(async move {
        while let Ok(msg_str) = gui_rx.recv().await {
            if tx_gui_broadcast.send(Message::Text(msg_str)).await.is_err() {
                break;
            }
        }
    });

    // Main loop: receives client WebSocket messages -> PTY writer
    while let Some(Ok(ws_msg)) = ws_receiver.next().await {
        match ws_msg {
            Message::Text(text) => {
                // Check if resize message
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    if val.get("type").and_then(|t| t.as_str()) == Some("resize") {
                        if let (Some(cols), Some(rows)) = (
                            val.get("cols").and_then(|c| c.as_u64()),
                            val.get("rows").and_then(|r| r.as_u64()),
                        ) {
                            if let Ok(master) = pty_master.lock() {
                                let _ = master.resize(PtySize {
                                    cols: cols as u16,
                                    rows: rows as u16,
                                    pixel_width: 0,
                                    pixel_height: 0,
                                });
                            }
                            continue;
                        }
                    }
                }

                process_terminal_input(text.as_bytes(), &pty_writer).await;

                if let Some(pid) = child_pid {
                    state.active_terminal_pid.store(pid, std::sync::atomic::Ordering::Relaxed);
                    if text.contains('\r') || text.contains('\n') {
                        let state_clone = state.clone();
                        tokio::spawn(async move {
                            tokio::time::sleep(tokio::time::Duration::from_millis(60)).await;
                            if let Some(new_cwd) = get_process_cwd(pid) {
                                let mut guard = state_clone.current_dir.write().await;
                                if *guard != new_cwd {
                                    info!("Terminal PID {} updated working directory: {:?}", pid, new_cwd);
                                    *guard = new_cwd;
                                }
                            }
                        });
                    }
                }
            }
            Message::Binary(bytes) => {
                // Check if binary payload is a UTF-8 JSON resize message
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(text) {
                        if val.get("type").and_then(|t| t.as_str()) == Some("resize") {
                            if let (Some(cols), Some(rows)) = (
                                val.get("cols").and_then(|c| c.as_u64()),
                                val.get("rows").and_then(|r| r.as_u64()),
                            ) {
                                if let Ok(master) = pty_master.lock() {
                                    let _ = master.resize(PtySize {
                                        cols: cols as u16,
                                        rows: rows as u16,
                                        pixel_width: 0,
                                        pixel_height: 0,
                                    });
                                }
                                continue;
                            }
                        }
                    }
                }

                process_terminal_input(&bytes, &pty_writer).await;

                if let Some(pid) = child_pid {
                    state.active_terminal_pid.store(pid, std::sync::atomic::Ordering::Relaxed);
                    if bytes.contains(&b'\r') || bytes.contains(&b'\n') {
                        let state_clone = state.clone();
                        tokio::spawn(async move {
                            tokio::time::sleep(tokio::time::Duration::from_millis(60)).await;
                            if let Some(new_cwd) = get_process_cwd(pid) {
                                let mut guard = state_clone.current_dir.write().await;
                                if *guard != new_cwd {
                                    info!("Terminal PID {} updated working directory: {:?}", pid, new_cwd);
                                    *guard = new_cwd;
                                }
                            }
                        });
                    }
                }
            }
            Message::Ping(p) => {
                let _ = tx_to_ws.send(Message::Pong(p)).await;
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Clean up
    broadcast_task.abort();
    forward_task.abort();
    reader_task.abort();
    let mut child_guard = child.lock().await;
    let _ = child_guard.kill();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_ansi_and_controls_clean() {
        assert_eq!(strip_ansi_and_controls("gui"), "gui");
        assert_eq!(strip_ansi_and_controls("gui open foo.scm"), "gui open foo.scm");
        assert_eq!(strip_ansi_and_controls("gui ratio 60:40"), "gui ratio 60:40");
        assert_eq!(strip_ansi_and_controls("echo gui"), "echo gui");
    }

    #[test]
    fn test_strip_ansi_escape_sequences() {
        // CSI cursor position response \x1b[1;1R before gui
        assert_eq!(strip_ansi_and_controls("\x1b[1;1Rgui"), "gui");
        // CSI device attributes response \x1b[?1;0c before gui
        assert_eq!(strip_ansi_and_controls("\x1b[?1;0cgui open test.scm"), "gui open test.scm");
        // Arrow keys \x1b[D, \x1b[C within command
        assert_eq!(strip_ansi_and_controls("g\x1b[D\x1b[Cui"), "gui");
    }

    #[test]
    fn test_strip_terminal_query_prefix_naked() {
        // In case \x1b[ was separated, naked prefix 1;1R or ?1;2c should also be stripped
        assert_eq!(strip_ansi_and_controls("1;1Rgui"), "gui");
        assert_eq!(strip_ansi_and_controls("?1;2cgui help"), "gui help");
        assert_eq!(strip_ansi_and_controls(">0;10;0cgui close"), "gui close");
    }

    #[test]
    fn test_handle_gui_command_help() {
        let (feedback, action) = handle_gui_command("gui");
        assert!(feedback.contains("Action: help"));
        assert!(action.is_none());
    }

    #[test]
    fn test_handle_gui_command_open() {
        let (feedback, action) = handle_gui_command("gui open my_code.scm");
        assert!(feedback.contains("my_code.scm"));
        assert_eq!(action.unwrap()["file"], "my_code.scm");
    }
}
