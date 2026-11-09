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

/// Spawns a PTY pair with the specified command (cmd="steel" or cmd="bash")
pub fn spawn_pty(
    cmd_name: &str,
    steel_bin: &Path,
    workspace_dir: &Path,
) -> Result<(Box<dyn MasterPty + Send>, Box<dyn portable_pty::Child + Send + Sync>), anyhow::Error> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let cmd = if cmd_name == "steel" {
        let bin = if steel_bin.exists() {
            steel_bin.to_path_buf()
        } else if Path::new("/root/.cargo/bin/steel").exists() {
            PathBuf::from("/root/.cargo/bin/steel")
        } else if cfg!(windows) {
            PathBuf::from("steel.exe")
        } else {
            PathBuf::from("steel")
        };
        let mut cb = CommandBuilder::new(bin);
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

/// Process terminal input stream from WebSocket to child PTY, intercepting "gui " lines
pub async fn process_terminal_input(
    bytes: &[u8],
    line_buf: &mut Vec<u8>,
    ignore_next_lf: &mut bool,
    pty_writer: &Arc<tokio::sync::Mutex<Box<dyn Write + Send>>>,
    tx_to_ws: &tokio::sync::mpsc::Sender<Message>,
    state: &Arc<AppState>,
) {
    let mut writer = pty_writer.lock().await;
    let mut pending_bytes = Vec::new();

    for &b in bytes {
        if *ignore_next_lf && b == b'\n' {
            *ignore_next_lf = false;
            continue;
        }
        *ignore_next_lf = false;

        if b == b'\r' || b == b'\n' {
            if b == b'\r' {
                *ignore_next_lf = true;
            }

            let line_str = String::from_utf8_lossy(line_buf).trim().to_string();
            let is_gui = line_str == "gui" || line_str.starts_with("gui ") || line_str.starts_with("gui\t");

            if is_gui {
                line_buf.clear();

                // 1. Flush any pending characters before Ctrl+C
                if !pending_bytes.is_empty() {
                    let _ = writer.write_all(&pending_bytes);
                    pending_bytes.clear();
                }

                // 2. Send \x03 (Ctrl+C) to child PTY to cancel bash command line without command-not-found
                let _ = writer.write_all(b"\x03");
                let _ = writer.flush();

                // 3. Handle GUI command
                let (feedback, action_opt) = handle_gui_command(&line_str);

                // Broadcast GUI action if available
                if let Some(mut action_val) = action_opt {
                    static BROADCAST_ACTION_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
                    let id = BROADCAST_ACTION_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    action_val["id"] = serde_json::json!(id);
                    if let Ok(json_str) = serde_json::to_string(&action_val) {
                        let _ = state.gui_broadcast.send(json_str);
                    }
                }

                // 4. Send formatted feedback to client terminal
                let _ = tx_to_ws.send(Message::Binary(feedback.into_bytes())).await;
            } else {
                line_buf.clear();
                pending_bytes.push(b);
            }
        } else if b == 0x7f || b == 0x08 {
            line_buf.pop();
            pending_bytes.push(b);
        } else if b == 0x15 || b == 0x03 {
            line_buf.clear();
            pending_bytes.push(b);
        } else {
            line_buf.push(b);
            pending_bytes.push(b);
        }
    }

    if !pending_bytes.is_empty() {
        let _ = writer.write_all(&pending_bytes);
        let _ = writer.flush();
    }
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
    let workspace_dir = std::env::var("WORKSPACE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let def = PathBuf::from("/workspace/scheme_edit");
            if def.exists() {
                def
            } else {
                PathBuf::from(".")
            }
        });

    info!(
        "Terminal session connected: tab_id={:?}, cmd={}, dir={:?}",
        params.tab_id, cmd_name, workspace_dir
    );

    let (pty_master, child) = match spawn_pty(cmd_name, &state.steel_bin, &workspace_dir) {
        Ok(res) => res,
        Err(e) => {
            error!("Failed to spawn PTY for cmd '{}': {e}", cmd_name);
            return;
        }
    };

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
    let mut line_buf = Vec::new();
    let mut ignore_next_lf = false;

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

                process_terminal_input(
                    text.as_bytes(),
                    &mut line_buf,
                    &mut ignore_next_lf,
                    &pty_writer,
                    &tx_to_ws,
                    &state,
                ).await;
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

                process_terminal_input(
                    &bytes,
                    &mut line_buf,
                    &mut ignore_next_lf,
                    &pty_writer,
                    &tx_to_ws,
                    &state,
                ).await;
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
