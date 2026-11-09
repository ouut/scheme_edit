use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub mod file_api;
pub mod terminal;

use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing::info;

#[derive(Debug)]
pub enum EvalProcessError {
    Io(std::io::Error),
    Exited,
}

pub struct SteelReplProcess {
    pub child: Child,
    pub stdin: ChildStdin,
    pub stdout_reader: BufReader<ChildStdout>,
    pub stderr_rx: tokio::sync::mpsc::UnboundedReceiver<String>,
}

impl SteelReplProcess {
    pub async fn spawn(steel_bin: &Path) -> Result<Self, std::io::Error> {
        let is_self = std::env::current_exe()
            .map(|exe| exe == *steel_bin)
            .unwrap_or(false);
        let mut cmd = Command::new(steel_bin);
        if is_self {
            cmd.arg("--steel");
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        let stdin = child.stdin.take().expect("failed to open stdin");
        let stdout = child.stdout.take().expect("failed to open stdout");
        let stderr = child.stderr.take().expect("failed to open stderr");

        let (stderr_tx, stderr_rx) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            while let Ok(n) = reader.read_line(&mut line).await {
                if n == 0 {
                    break;
                }
                let _ = stderr_tx.send(std::mem::take(&mut line));
            }
        });

        let mut stdout_reader = BufReader::new(stdout);

        // Consume initial startup banner and prompt by sending a sentinel
        let init_sentinel = "---STEEL_INIT_READY---";
        let mut init_stdin = stdin;
        init_stdin
            .write_all(format!("(displayln \"{}\")\n", init_sentinel).as_bytes())
            .await?;
        init_stdin.flush().await?;

        let mut line = String::new();
        while let Ok(n) = stdout_reader.read_line(&mut line).await {
            if n == 0 || line.contains(init_sentinel) {
                break;
            }
            line.clear();
        }

        // Drain any initial stderr
        let mut rx = stderr_rx;
        while rx.try_recv().is_ok() {}

        Ok(SteelReplProcess {
            child,
            stdin: init_stdin,
            stdout_reader,
            stderr_rx: rx,
        })
    }

    pub async fn eval(
        &mut self,
        code: &str,
        eval_id: u64,
    ) -> Result<(String, String), EvalProcessError> {
        // Drain any stale stderr from previous evals
        while self.stderr_rx.try_recv().is_ok() {}

        let sentinel = format!("---STEEL_SENTINEL_{}---", eval_id);
        let cmd = format!("{}\n(displayln \"{}\")\n", code, sentinel);

        self.stdin
            .write_all(cmd.as_bytes())
            .await
            .map_err(EvalProcessError::Io)?;
        self.stdin.flush().await.map_err(EvalProcessError::Io)?;

        let mut raw_stdout = String::new();
        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .stdout_reader
                .read_line(&mut line)
                .await
                .map_err(EvalProcessError::Io)?;
            if n == 0 {
                return Err(EvalProcessError::Exited);
            }
            if line.contains(&sentinel) {
                break;
            }
            raw_stdout.push_str(&line);
        }

        // Allow background reader task to drain any pending stderr from OS pipe
        tokio::time::sleep(Duration::from_millis(5)).await;

        let mut stderr_acc = String::new();
        while let Ok(err_line) = self.stderr_rx.try_recv() {
            stderr_acc.push_str(&err_line);
        }

        Ok((raw_stdout, stderr_acc))
    }
}

#[derive(Clone)]
pub struct AppState {
    pub steel_bin: PathBuf,
    pub steel_version: String,
    pub static_dir: Option<PathBuf>,
    pub serve_embedded: bool,
    pub repl: Arc<tokio::sync::Mutex<Option<SteelReplProcess>>>,
    pub eval_counter: Arc<AtomicU64>,
    pub gui_broadcast: tokio::sync::broadcast::Sender<String>,
}

#[derive(Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub steel: String,
}

#[derive(Serialize, Deserialize)]
pub struct EvalRequest {
    pub code: String,
    #[serde(default)]
    pub buffer: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct EvalResponse {
    pub ok: bool,
    pub result: String,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

/// Extract defined identifier name from a (define ...) form
pub fn extract_defined_name(def: &str) -> Option<String> {
    let s = def.trim();
    if !s.starts_with("(define") {
        return None;
    }
    let mut rem = s[7..].trim_start();
    if rem.starts_with('(') {
        rem = rem[1..].trim_start();
    }
    let mut token = String::new();
    for c in rem.chars() {
        if c.is_whitespace()
            || c == '('
            || c == ')'
            || c == '['
            || c == ']'
            || c == '"'
            || c == ';'
        {
            break;
        }
        token.push(c);
    }
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

/// Extract top-level (define ...) expressions from code, returning (defined_name, full_def_str)
pub fn extract_definitions(text: &str) -> Vec<(String, String)> {
    let mut defs = Vec::new();
    let bytes = text.as_bytes();
    let n = bytes.len();
    let mut i = 0;

    while i < n {
        if bytes[i] == b';' {
            while i < n && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        if bytes[i] == b'(' {
            let rem = &text[i..];
            if rem.starts_with("(define ")
                || rem.starts_with("(define\n")
                || rem.starts_with("(define\t")
                || rem.starts_with("(define(")
            {
                let start = i;
                let mut depth = 0i32;
                let mut j = i;
                let mut in_str = false;
                let mut escape = false;

                while j < n {
                    let b = bytes[j];
                    if in_str {
                        if escape {
                            escape = false;
                        } else if b == b'\\' {
                            escape = true;
                        } else if b == b'"' {
                            in_str = false;
                        }
                    } else if b == b';' {
                        while j < n && bytes[j] != b'\n' {
                            j += 1;
                        }
                        continue;
                    } else if b == b'"' {
                        in_str = true;
                    } else if b == b'(' || b == b'[' {
                        depth += 1;
                    } else if b == b')' || b == b']' {
                        depth -= 1;
                        if depth == 0 {
                            let def_str = text[start..=j].to_string();
                            if let Some(name) = extract_defined_name(&def_str) {
                                defs.push((name, def_str));
                            }
                            i = j;
                            break;
                        }
                    }
                    j += 1;
                }
            }
        }
        i += 1;
    }
    defs
}

/// Extract referenced symbols from an expression
pub fn extract_referenced_symbols(code: &str) -> HashSet<String> {
    let mut symbols = HashSet::new();
    let bytes = code.as_bytes();
    let n = bytes.len();
    let mut i = 0;
    let mut in_str = false;
    let mut escape = false;

    while i < n {
        let b = bytes[i];
        if in_str {
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_str = false;
            }
            i += 1;
            continue;
        }

        if b == b';' {
            while i < n && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        if b == b'"' {
            in_str = true;
            i += 1;
            continue;
        }

        if b.is_ascii_whitespace()
            || b == b'('
            || b == b')'
            || b == b'['
            || b == b']'
            || b == b'{'
            || b == b'}'
            || b == b'\''
            || b == b'`'
            || b == b','
        {
            i += 1;
            continue;
        }

        let start = i;
        while i < n {
            let cb = bytes[i];
            if cb.is_ascii_whitespace()
                || cb == b'('
                || cb == b')'
                || cb == b'['
                || cb == b']'
                || cb == b'{'
                || cb == b'}'
                || cb == b'"'
                || cb == b';'
                || cb == b'\''
                || cb == b'`'
                || cb == b','
            {
                break;
            }
            i += 1;
        }
        let tok = &code[start..i];
        // Ignore pure numbers (e.g. 10, -5, 3.14)
        if !tok.chars().all(|c| c.is_ascii_digit() || c == '.' || c == '-')
            || tok == "-"
            || tok == "+"
        {
            symbols.insert(tok.to_string());
        }
    }
    symbols
}

/// Resolve only the definitions transitively required by `code`, avoiding unrelated broken definitions
pub fn resolve_dependent_definitions(code: &str, defs: &[(String, String)]) -> Vec<String> {
    let mut def_map: HashMap<&str, (&str, usize)> = HashMap::new();
    for (idx, (name, full_def)) in defs.iter().enumerate() {
        def_map.insert(name.as_str(), (full_def.as_str(), idx));
    }

    let mut needed_names = HashSet::new();
    let initial_symbols = extract_referenced_symbols(code);
    let mut to_visit: Vec<String> = initial_symbols.into_iter().collect();
    let mut visited_symbols: HashSet<String> = to_visit.iter().cloned().collect();

    while let Some(sym) = to_visit.pop() {
        if let Some(&(full_def, _)) = def_map.get(sym.as_str()) {
            needed_names.insert(sym);
            let child_symbols = extract_referenced_symbols(full_def);
            for cs in child_symbols {
                if !visited_symbols.contains(&cs) {
                    visited_symbols.insert(cs.clone());
                    to_visit.push(cs);
                }
            }
        }
    }

    let trimmed_code = code.trim();
    let mut result = Vec::new();
    for (name, full_def) in defs {
        if needed_names.contains(name.as_str()) && full_def.trim() != trimmed_code {
            result.push(full_def.clone());
        }
    }
    result
}

/// Strip ANSI escape codes from terminal output.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() || next == '~' {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Parse steel REPL stdout into stdout and evaluated result strings.
pub fn parse_repl_output(raw: &str) -> (String, String) {
    let cleaned = strip_ansi(raw);

    // Locate end of ASCII art banner if present
    let banner_marker = "/____/\\__/\\___/\\___/_/";
    let after_banner = if let Some(idx) = cleaned.find(banner_marker) {
        &cleaned[idx + banner_marker.len()..]
    } else if let Some(idx) = cleaned.find("λ > ") {
        &cleaned[idx..]
    } else {
        &cleaned
    };

    let normalized = after_banner.replace("λ > ", "\n");
    let mut stdout_parts = Vec::new();
    let mut results = Vec::new();

    for line in normalized.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed == "CTRL-D" {
            continue;
        }
        let trimmed = if let Some(rem) = trimmed.strip_prefix("CTRL-D") {
            rem.trim()
        } else {
            trimmed
        };
        if trimmed.is_empty() {
            continue;
        }

        if let Some(pos) = trimmed.find("=> ") {
            let prefix = trimmed[..pos].trim();
            let res = trimmed[pos + 3..].trim();
            if !prefix.is_empty() {
                stdout_parts.push(prefix.to_string());
            }
            if !res.is_empty() {
                results.push(res.to_string());
            }
        } else if let Some(res) = trimmed.strip_prefix("=>") {
            let res = res.trim();
            if !res.is_empty() {
                results.push(res.to_string());
            }
        } else {
            stdout_parts.push(trimmed.to_string());
        }
    }

    let stdout = stdout_parts.join("\n");
    let result = results.join("\n");
    (stdout, result)
}

/// Check if code has unbalanced delimiters (e.g. unclosed parentheses).
pub fn has_unclosed_delimiter(code: &str) -> bool {
    let mut round = 0i32;
    let mut square = 0i32;
    let mut curly = 0i32;
    let mut in_string = false;
    let mut escape = false;
    let mut in_comment = false;

    for c in code.chars() {
        if in_comment {
            if c == '\n' {
                in_comment = false;
            }
            continue;
        }
        if in_string {
            if escape {
                escape = false;
            } else if c == '\\' {
                escape = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }

        match c {
            ';' => in_comment = true,
            '"' => in_string = true,
            '(' => round += 1,
            ')' => round -= 1,
            '[' => square += 1,
            ']' => square -= 1,
            '{' => curly += 1,
            '}' => curly -= 1,
            _ => {}
        }
    }

    in_string || round != 0 || square != 0 || curly != 0
}

/// Locate the steel executable.
pub fn find_steel_binary() -> PathBuf {
    if let Ok(bin) = std::env::var("STEEL_BIN") {
        let p = PathBuf::from(bin);
        if p.exists() {
            return p;
        }
    }

    // 1. Check right next to current executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = if cfg!(windows) {
                dir.join("steel.exe")
            } else {
                dir.join("steel")
            };
            if candidate.exists() {
                return candidate;
            }
        }
    }

    // 2. Check ~/.cargo/bin/steel
    let cargo_bin = PathBuf::from("/root/.cargo/bin/steel");
    if cargo_bin.exists() {
        return cargo_bin;
    }

    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        let p = PathBuf::from(&home).join(".cargo/bin/steel");
        if p.exists() {
            return p;
        }
        let p_exe = PathBuf::from(&home).join(".cargo/bin/steel.exe");
        if p_exe.exists() {
            return p_exe;
        }
    }

    // 3. Check system PATH
    if let Ok(which_path) = which::which(if cfg!(windows) { "steel.exe" } else { "steel" }) {
        return which_path;
    }

    // 4. Return current executable! (Embedded Steel Scheme)
    if let Ok(exe) = std::env::current_exe() {
        if exe.to_string_lossy().contains("deps") {
            if let Some(parent) = exe.parent().and_then(|p| p.parent()) {
                let bin_name = if cfg!(windows) { "scheme-ide.exe" } else { "scheme-ide" };
                let candidate = parent.join(bin_name);
                if candidate.exists() {
                    return candidate;
                }
            }
        } else {
            return exe;
        }
    }

    if cfg!(windows) {
        PathBuf::from("steel.exe")
    } else {
        PathBuf::from("steel")
    }
}

/// Detect steel version by running `steel --version`.
pub fn detect_steel_version(steel_bin: &Path) -> String {
    let mut cmd = std::process::Command::new(steel_bin);
    cmd.arg("--version");
    if let Ok(output) = cmd.output() {
        let s = String::from_utf8_lossy(&output.stdout);
        if let Some(v) = s.trim().strip_prefix("steel ") {
            return v.trim().to_string();
        }
        if !s.trim().is_empty() {
            return s.trim().to_string();
        }
    }
    let is_self = std::env::current_exe()
        .map(|exe| exe == *steel_bin)
        .unwrap_or(false);
    if is_self {
        return "0.8.2 (embedded)".to_string();
    }
    "0.8.2".to_string()
}

/// Helper function to detect local network IP address
pub fn detect_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let local_addr = socket.local_addr().ok()?;
    let ip = local_addr.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        None
    } else {
        Some(ip.to_string())
    }
}

/// Resolve the directory for static file serving.
pub fn resolve_static_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("STATIC_DIR") {
        let p = PathBuf::from(dir);
        if p.exists() {
            return Some(p);
        }
    }

    let candidates = [
        PathBuf::from("./frontend/dist"),
        PathBuf::from("../frontend/dist"),
        PathBuf::from("./static"),
        PathBuf::from("../static"),
    ];
    for p in candidates {
        if p.exists() {
            return Some(p);
        }
    }

    None
}

/// GET /api/health handler
pub async fn health_handler(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        steel: state.steel_version.clone(),
    })
}

/// POST /api/reset handler
pub async fn reset_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let mut repl_guard = state.repl.lock().await;
    if let Some(mut proc) = repl_guard.take() {
        let _ = proc.child.kill().await;
    }
    Json(serde_json::json!({ "ok": true, "message": "REPL session reset" }))
}

/// POST /api/eval handler
pub async fn eval_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<EvalRequest>,
) -> Json<EvalResponse> {
    let code = payload.code;

    // Instant return for empty/blank code
    if code.trim().is_empty() {
        return Json(EvalResponse {
            ok: true,
            result: String::new(),
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: 0,
        });
    }

    // Instant syntax check for unclosed parentheses, brackets, or strings
    if has_unclosed_delimiter(&code) {
        return Json(EvalResponse {
            ok: false,
            result: String::new(),
            stdout: String::new(),
            stderr: "error[E09]: Parse: Syntax Error: Unexpected EOF, unclosed delimiter (parenthesis, bracket, or string)".to_string(),
            duration_ms: 0,
        });
    }

    let start = Instant::now();
    let trimmed_code = code.trim();
    let is_definition = trimmed_code.starts_with("(define");

    // Dependency-aware definition prepending if buffer is provided
    let mut prepended = String::new();
    if let Some(ref buffer) = payload.buffer {
        let defs = extract_definitions(buffer);
        let dep_defs = resolve_dependent_definitions(&code, &defs);
        for def in dep_defs {
            prepended.push_str(&def);
            prepended.push('\n');
        }
    }

    let full_code = if prepended.is_empty() {
        code.clone()
    } else {
        format!("{}\n{}", prepended, code)
    };

    let eval_id = state.eval_counter.fetch_add(1, Ordering::SeqCst);
    let mut repl_guard = state.repl.lock().await;

    // Ensure persistent interactive REPL process is spawned and alive
    if repl_guard.is_none() {
        match SteelReplProcess::spawn(&state.steel_bin).await {
            Ok(proc) => *repl_guard = Some(proc),
            Err(e) => {
                return Json(EvalResponse {
                    ok: false,
                    result: String::new(),
                    stdout: String::new(),
                    stderr: format!("Failed to spawn steel process: {e}"),
                    duration_ms: start.elapsed().as_millis() as u64,
                });
            }
        }
    }

    let repl = repl_guard.as_mut().unwrap();
    let timeout_duration = Duration::from_secs(5);
    let eval_res = tokio::time::timeout(timeout_duration, repl.eval(&full_code, eval_id)).await;

    match eval_res {
        Err(_timeout) => {
            let _ = repl.child.kill().await;
            *repl_guard = None;
            Json(EvalResponse {
                ok: false,
                result: String::new(),
                stdout: String::new(),
                stderr: "Execution timed out (5s limit)".to_string(),
                duration_ms: start.elapsed().as_millis() as u64,
            })
        }
        Ok(Err(EvalProcessError::Exited)) => {
            *repl_guard = None;
            Json(EvalResponse {
                ok: false,
                result: String::new(),
                stdout: String::new(),
                stderr: "REPL process terminated (exit called or crashed)".to_string(),
                duration_ms: start.elapsed().as_millis() as u64,
            })
        }
        Ok(Err(EvalProcessError::Io(e))) => {
            *repl_guard = None;
            Json(EvalResponse {
                ok: false,
                result: String::new(),
                stdout: String::new(),
                stderr: format!("REPL communication error: {e}"),
                duration_ms: start.elapsed().as_millis() as u64,
            })
        }
        Ok(Ok((raw_stdout, raw_stderr))) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            let (stdout, mut result) = parse_repl_output(&raw_stdout);
            let stderr_cleaned = strip_ansi(&raw_stderr).trim().to_string();

            let ok = stderr_cleaned.is_empty();

            if ok {
                if is_definition {
                    if result.is_empty() {
                        result = "#<void> (defined)".to_string();
                    }
                } else if result.is_empty() && stdout.is_empty() {
                    result = "#<void>".to_string();
                }
            }

            Json(EvalResponse {
                ok,
                result,
                stdout,
                stderr: stderr_cleaned,
                duration_ms,
            })
        }
    }
}

/// Fallback message when static files cannot be found.
pub fn friendly_fallback_html() -> &'static str {
    r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Scheme Editor</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #18181b;
            color: #f4f4f5;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 1.5rem;
            box-sizing: border-box;
        }
        .card {
            background: #27272a;
            border: 1px solid #3f3f46;
            border-radius: 12px;
            padding: 2rem;
            max-width: 600px;
            width: 100%;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        }
        h1 {
            margin-top: 0;
            color: #38bdf8;
            font-size: 1.6rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        p {
            color: #a1a1aa;
            line-height: 1.6;
        }
        code {
            background: #18181b;
            color: #a78bfa;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 0.9em;
        }
        .endpoints {
            margin-top: 1.5rem;
            border-top: 1px solid #3f3f46;
            padding-top: 1rem;
        }
        .endpoints h2 {
            font-size: 1.1rem;
            color: #e4e4e7;
            margin-bottom: 0.5rem;
        }
        .endpoint {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
        }
        .method {
            padding: 0.15rem 0.4rem;
            border-radius: 4px;
            font-weight: bold;
            font-size: 0.75rem;
        }
        .get { background: #065f46; color: #6ee7b7; }
        .post { background: #1e40af; color: #93c5fd; }
        .hint {
            margin-top: 1.5rem;
            padding: 0.75rem;
            background: #18181b;
            border-left: 3px solid #38bdf8;
            border-radius: 4px;
            font-size: 0.85rem;
            color: #94a3b8;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>
            <span>λ</span> Scheme Editor Backend
        </h1>
        <p>The backend API server is up and running with embedded <strong>Steel Scheme REPL</strong>.</p>
        <p>Frontend static files were not found in the configured directory. To view the full IDE, build the frontend:</p>
        <p><code>cd frontend &amp;&amp; npm run build</code></p>
        
        <div class="endpoints">
            <h2>Available API Endpoints</h2>
            <div class="endpoint">
                <span class="method get">GET</span>
                <code>/api/health</code> - Server and Steel status
            </div>
            <div class="endpoint">
                <span class="method post">POST</span>
                <code>/api/eval</code> - Evaluate Scheme S-expressions
            </div>
            <div class="endpoint">
                <span class="method post">POST</span>
                <code>/api/reset</code> - Reset REPL session
            </div>
        </div>

        <div class="hint">
            Tip: In development, run Vite dev server via <code>cd frontend &amp;&amp; npm run dev</code>.
        </div>
    </div>
</body>
</html>"#
}

#[derive(rust_embed::RustEmbed)]
#[folder = "../frontend/dist/"]
pub struct EmbeddedAssets;

/// Handler for serving embedded assets with mime types and SPA fallback to index.html
pub async fn embedded_static_handler(uri: axum::http::Uri) -> impl IntoResponse {
    let raw_path = uri.path().trim_start_matches('/');
    let path = if raw_path.is_empty() {
        "index.html"
    } else {
        raw_path
    };

    if let Some(content) = EmbeddedAssets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        return (
            [
                (header::CONTENT_TYPE, mime.as_ref()),
            ],
            content.data,
        )
            .into_response();
    }

    // SPA fallback: for any route without file extension (or HTML), return index.html
    if !path.contains('.') || path.ends_with(".html") {
        if let Some(index) = EmbeddedAssets::get("index.html") {
            return (
                [
                    (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                ],
                index.data,
            )
                .into_response();
        }
    }

    (StatusCode::NOT_FOUND, "404 Not Found").into_response()
}

/// Fallback route when requested asset doesn't exist
pub async fn friendly_fallback_handler() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        Html(friendly_fallback_html()),
    )
}

/// Create the axum app router with all routes and static file handling.
pub fn create_app(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::permissive();

    let router = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/eval", post(eval_handler))
        .route("/api/reset", post(reset_handler))
        .route(
            "/api/file",
            get(file_api::read_file_handler).post(file_api::write_file_handler),
        )
        .route("/api/gui", post(file_api::gui_action_handler))
        .route("/ws/terminal", get(terminal::ws_terminal_handler));

    let router = if let Some(ref dir) = state.static_dir {
        let index_path = dir.join("index.html");
        if index_path.exists() {
            router.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index_path)))
        } else {
            router.fallback_service(
                ServeDir::new(dir).fallback(axum::routing::get(friendly_fallback_handler)),
            )
        }
    } else if state.serve_embedded && EmbeddedAssets::get("index.html").is_some() {
        router.fallback(embedded_static_handler)
    } else {
        router.fallback(friendly_fallback_handler)
    };

    router
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();

    // 1. Embedded Steel REPL / evaluator subcommand
    if args.len() > 1 && (args[1] == "--steel" || args[1] == "steel" || args[1] == "repl") {
        let mut sub_args = vec![args[0].clone()];
        sub_args.extend_from_slice(&args[2..]);
        use clap::Parser;
        let cli_args = steel_interpreter::SteelCliArgs::parse_from(sub_args);
        if let Err(e) = steel_interpreter::run(cli_args) {
            eprintln!("Steel error: {e}");
            std::process::exit(1);
        }
        return;
    }

    // 2. Help flag
    if args.len() > 1 && (args[1] == "--help" || args[1] == "-h") {
        println!("Scheme Strict Paredit IDE");
        println!();
        println!("USAGE:");
        println!("  scheme-ide [OPTIONS]");
        println!("  scheme-ide --steel [STEEL_ARGS...]");
        println!();
        println!("OPTIONS:");
        println!("  --port <PORT>        Port to listen on [default: 3000, env: PORT]");
        println!("  --steel [ARGS...]    Run the embedded Steel Scheme REPL or execute a script");
        println!("  -h, --help           Print help information");
        println!("  -V, --version        Print version information");
        return;
    }

    // 3. Version flag
    if args.len() > 1 && (args[1] == "--version" || args[1] == "-V") {
        println!("scheme-ide {} (with embedded Steel Scheme 0.8.2)", env!("CARGO_PKG_VERSION"));
        return;
    }

    tracing_subscriber::fmt::init();

    // Parse port from CLI argument (--port <PORT>) or PORT environment variable
    let mut port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    for i in 1..args.len() {
        if args[i] == "--port" && i + 1 < args.len() {
            if let Ok(p) = args[i + 1].parse() {
                port = p;
            }
        }
    }

    let steel_bin = find_steel_binary();
    let steel_version = detect_steel_version(&steel_bin);
    let static_dir = resolve_static_dir();

    info!(
        "Scheme Editor Server initializing: steel={:?} version={} static_dir={:?}",
        steel_bin, steel_version, static_dir
    );

    let (gui_broadcast, _) = tokio::sync::broadcast::channel(100);

    let state = Arc::new(AppState {
        steel_bin,
        steel_version: steel_version.clone(),
        static_dir,
        serve_embedded: true,
        repl: Arc::new(tokio::sync::Mutex::new(None)),
        eval_counter: Arc::new(AtomicU64::new(1)),
        gui_broadcast,
    });

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind to {addr}: {e}");
            std::process::exit(1);
        }
    };

    let local_ip = detect_local_ip();

    println!("==================================================");
    println!("  Scheme Strict Paredit IDE");
    println!("  Port: {port}");
    println!("  Embedded Frontend: Monaco Editor + xterm.js (Ready)");
    println!("  Steel Scheme: {steel_version}");
    println!("==================================================");
    println!("--------------------------------------------------");
    println!("🚀 Scheme Editor 启动就绪！");
    println!("   - 本机 / 端口转发访问:   http://localhost:{port}");
    if let Some(ref ip) = local_ip {
        println!("   - 宿主机 / 局域网直连:   http://{ip}:{port}");
    }
    println!("--------------------------------------------------");
    println!("💡 提示: 如果在远程或虚拟机运行，浏览器无法直接打开 localhost:{port}:");
    if let Some(ref ip) = local_ip {
        println!("   1. 请在宿主机浏览器直接打开: http://{ip}:{port}");
    }
    println!("   2. 或者在 VS Code 底部「端口 (PORTS)」面板添加转发端口 {port}");
    println!("==================================================");

    info!("Listening on http://0.0.0.0:{}", port);

    let app = create_app(state);

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Server error: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_app() -> Router {
        let steel_bin = find_steel_binary();
        let steel_version = detect_steel_version(&steel_bin);
        let (gui_broadcast, _) = tokio::sync::broadcast::channel(100);
        let state = Arc::new(AppState {
            steel_bin,
            steel_version,
            static_dir: None,
            serve_embedded: false,
            repl: Arc::new(tokio::sync::Mutex::new(None)),
            eval_counter: Arc::new(AtomicU64::new(1)),
            gui_broadcast,
        });
        create_app(state)
    }

    #[test]
    fn test_strip_ansi() {
        let raw = "\x1b[32mhello\x1b[0m world";
        assert_eq!(strip_ansi(raw), "hello world");
    }

    #[test]
    fn test_extract_defined_name() {
        assert_eq!(
            extract_defined_name("(define (fib n) ...)"),
            Some("fib".to_string())
        );
        assert_eq!(
            extract_defined_name("(define cards '(1 2 3))"),
            Some("cards".to_string())
        );
        assert_eq!(
            extract_defined_name("(define\n  (square x)\n  (* x x))"),
            Some("square".to_string())
        );
    }

    #[test]
    fn test_parse_repl_output_basic() {
        let raw = "\n     _____ __            __\n    / ___// /____  ___  / /          Version 0.8.2 \n    \\__ \\/ __/ _ \\/ _ \\/ /           https://github.com/mattwparas/steel\n   ___/ / /_/  __/  __/ /            :? for help\n  /____/\\__/\\___/\\___/_/\n    \nλ > => 3\nλ > CTRL-D\n";
        let (stdout, result) = parse_repl_output(raw);
        assert_eq!(stdout, "");
        assert_eq!(result, "3");
    }

    #[test]
    fn test_parse_repl_output_stdout_and_result() {
        let raw = "\n     _____ __            __\n    / ___// /____  ___  / /          Version 0.8.2 \n    \\__ \\/ __/ _ \\/ _ \\/ /           https://github.com/mattwparas/steel\n   ___/ / /_/  __/  __/ /            :? for help\n  /____/\\__/\\___/\\___/_/\n    \nλ > hello\nλ > => 30\nλ > CTRL-D\n";
        let (stdout, result) = parse_repl_output(raw);
        assert_eq!(stdout, "hello");
        assert_eq!(result, "30");
    }

    #[test]
    fn test_parse_repl_output_without_prompts() {
        let raw = "\n     _____ __            __\n    / ___// /____  ___  / /          Version 0.8.2 \n    \\__ \\/ __/ _ \\/ _ \\/ /           https://github.com/mattwparas/steel\n   ___/ / /_/  __/  __/ /            :? for help\n  /____/\\__/\\___/\\___/_/\n    \n=> 3\nCTRL-D\n";
        let (stdout, result) = parse_repl_output(raw);
        assert_eq!(stdout, "");
        assert_eq!(result, "3");
    }

    #[test]
    fn test_parse_repl_output_stdout_and_result_without_prompts() {
        let raw = "\n     _____ __            __\n    / ___// /____  ___  / /          Version 0.8.2 \n    \\__ \\/ __/ _ \\/ _ \\/ /           https://github.com/mattwparas/steel\n   ___/ / /_/  __/  __/ /            :? for help\n  /____/\\__/\\___/\\___/_/\n    \nhello\n=> 30\nCTRL-D\n";
        let (stdout, result) = parse_repl_output(raw);
        assert_eq!(stdout, "hello");
        assert_eq!(result, "30");
    }

    #[test]
    fn test_has_unclosed_delimiter() {
        assert!(has_unclosed_delimiter("(+ 1"));
        assert!(has_unclosed_delimiter("[(+ 1 2)"));
        assert!(has_unclosed_delimiter("\"hello"));
        assert!(!has_unclosed_delimiter("(+ 1 2)"));
        assert!(!has_unclosed_delimiter("(define (f x) (* x x))"));
    }

    #[tokio::test]
    async fn test_health_endpoint() {
        let app = test_app();
        let req = Request::builder()
            .uri("/api/health")
            .method("GET")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "ok");
        assert!(json["steel"].as_str().map(|v| v.contains("0.8")).unwrap_or(false));
    }

    #[tokio::test]
    async fn test_eval_simple_math() {
        let app = test_app();
        let req = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"code": "(+ 1 2)"}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let eval: EvalResponse = serde_json::from_slice(&body).unwrap();
        assert!(eval.ok);
        assert_eq!(eval.result, "3");
        assert_eq!(eval.stdout, "");
        assert_eq!(eval.stderr, "");
    }

    #[tokio::test]
    async fn test_eval_definition_and_function() {
        let app = test_app();
        let code = r#"
            (define (factorial n)
              (if (<= n 1)
                  1
                  (* n (factorial (- n 1)))))
            (factorial 5)
        "#;
        let req = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_string(&EvalRequest {
                    code: code.to_string(),
                    buffer: None,
                })
                .unwrap(),
            ))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let eval: EvalResponse = serde_json::from_slice(&body).unwrap();
        assert!(eval.ok);
        assert_eq!(eval.result, "120");
    }

    #[tokio::test]
    async fn test_eval_with_buffer_definitions() {
        let app = test_app();
        let buffer = r#"
            (define (fib n)
              (cond
                [(= n 0) 0]
                [(= n 1) 1]
                [else (+ (fib (- n 1)) (fib (- n 2)))]))
            (fib 10)
        "#;
        let req = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_string(&EvalRequest {
                    code: "(fib 10)".to_string(),
                    buffer: Some(buffer.to_string()),
                })
                .unwrap(),
            ))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let eval: EvalResponse = serde_json::from_slice(&body).unwrap();
        assert!(eval.ok);
        assert_eq!(eval.result, "55");
    }

    #[tokio::test]
    async fn test_eval_with_polluted_buffer() {
        let app = test_app();
        // Buffer contains deliberately broken definitions from interactive exercises
        let buffer = r#"
            (define test-binding
              (let* (x 100)
                (+ x 1)))

            (define (check-access u has-permission?)
              (if (and (user-logged-in? u) (user-admin? u)) has-permission?
                  "Access Denied"
                  "Access Granted"))

            (define (fib n)
              (cond
                [(= n 0) 0]
                [(= n 1) 1]
                [else (+ (fib (- n 1)) (fib (- n 2)))]))
        "#;
        // Evaluation of independent expression (+ 1 1) MUST NOT fail
        let req = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_string(&EvalRequest {
                    code: "(+ 1 1)".to_string(),
                    buffer: Some(buffer.to_string()),
                })
                .unwrap(),
            ))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let eval: EvalResponse = serde_json::from_slice(&body).unwrap();
        assert!(eval.ok, "Expected ok: true, got stderr: {}", eval.stderr);
        assert_eq!(eval.result, "2");
    }

    #[tokio::test]
    async fn test_eval_state_persistence() {
        let app = test_app();
        // Step 1: Define variable
        let req1 = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"code": "(define my-score 42)"}"#))
            .unwrap();
        let resp1 = app.clone().oneshot(req1).await.unwrap();
        assert_eq!(resp1.status(), StatusCode::OK);

        // Step 2: Use defined variable in next evaluation
        let req2 = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"code": "(+ my-score 8)"}"#))
            .unwrap();
        let resp2 = app.oneshot(req2).await.unwrap();
        assert_eq!(resp2.status(), StatusCode::OK);

        let body2 = resp2.into_body().collect().await.unwrap().to_bytes();
        let eval2: EvalResponse = serde_json::from_slice(&body2).unwrap();
        assert!(eval2.ok);
        assert_eq!(eval2.result, "50");
    }

    #[tokio::test]
    async fn test_eval_displayln_stdout() {
        let app = test_app();
        let code = r#"
            (displayln "Hello from Steel!")
            (+ 10 20)
        "#;
        let req = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_string(&EvalRequest {
                    code: code.to_string(),
                    buffer: None,
                })
                .unwrap(),
            ))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let eval: EvalResponse = serde_json::from_slice(&body).unwrap();
        assert!(eval.ok);
        assert_eq!(eval.stdout, "Hello from Steel!");
        assert_eq!(eval.result, "30");
    }

    #[tokio::test]
    async fn test_eval_runtime_error() {
        let app = test_app();
        let req = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"code": "(/ 1 0)"}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let eval: EvalResponse = serde_json::from_slice(&body).unwrap();
        assert!(!eval.ok);
        assert!(eval.stderr.contains("division by zero"));
    }

    #[tokio::test]
    async fn test_eval_unclosed_paren_syntax_error() {
        let app = test_app();
        let req = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"code": "(+ 1 2"}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let eval: EvalResponse = serde_json::from_slice(&body).unwrap();
        assert!(!eval.ok);
        assert!(eval.stderr.contains("Parse") || eval.stderr.contains("Unexpected EOF"));
    }

    #[tokio::test]
    async fn test_eval_timeout() {
        let app = test_app();
        let req = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"code": "(let loop () (loop))"}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let eval: EvalResponse = serde_json::from_slice(&body).unwrap();
        assert!(!eval.ok);
        assert!(eval.stderr.contains("timed out"));
        assert!(eval.duration_ms >= 4000);
    }

    #[tokio::test]
    async fn test_eval_reset_endpoint() {
        let app = test_app();
        // Define x
        let req1 = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"code": "(define temp-x 999)"}"#))
            .unwrap();
        let resp1 = app.clone().oneshot(req1).await.unwrap();
        assert_eq!(resp1.status(), StatusCode::OK);

        // Reset
        let req_reset = Request::builder()
            .uri("/api/reset")
            .method("POST")
            .body(Body::empty())
            .unwrap();
        let resp_reset = app.clone().oneshot(req_reset).await.unwrap();
        assert_eq!(resp_reset.status(), StatusCode::OK);

        // temp-x should now be undefined in new process
        let req2 = Request::builder()
            .uri("/api/eval")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"code": "temp-x"}"#))
            .unwrap();
        let resp2 = app.oneshot(req2).await.unwrap();
        assert_eq!(resp2.status(), StatusCode::OK);

        let body2 = resp2.into_body().collect().await.unwrap().to_bytes();
        let eval2: EvalResponse = serde_json::from_slice(&body2).unwrap();
        assert!(!eval2.ok);
        assert!(eval2.stderr.contains("FreeIdentifier") || eval2.stderr.contains("temp-x"));
    }

    #[tokio::test]
    async fn test_fallback_page() {
        let app = test_app();
        let req = Request::builder()
            .uri("/")
            .method("GET")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let html = String::from_utf8_lossy(&body);
        assert!(html.contains("Scheme Editor Backend"));
    }

    #[tokio::test]
    async fn test_embedded_assets_serving() {
        if EmbeddedAssets::get("index.html").is_none() {
            return;
        }
        let steel_bin = find_steel_binary();
        let steel_version = detect_steel_version(&steel_bin);
        let (gui_broadcast, _) = tokio::sync::broadcast::channel(100);
        let state = Arc::new(AppState {
            steel_bin,
            steel_version,
            static_dir: None,
            serve_embedded: true,
            repl: Arc::new(tokio::sync::Mutex::new(None)),
            eval_counter: Arc::new(AtomicU64::new(1)),
            gui_broadcast,
        });
        let app = create_app(state);
        let req = Request::builder()
            .uri("/")
            .method("GET")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let html = String::from_utf8_lossy(&body);
        assert!(html.contains("<html") || html.contains("<!DOCTYPE html>") || html.contains("<!doctype html>"));
    }

    #[test]
    fn test_gui_command_parsing() {
        use crate::terminal::handle_gui_command;

        // Help
        let (fb, action) = handle_gui_command("gui help");
        assert!(fb.contains("[GUI] Action: help") || fb.contains("[GUI]"));
        assert!(fb.contains("gui open"));
        assert!(action.is_none());

        let (fb, action) = handle_gui_command("gui");
        assert!(fb.contains("gui open"));
        assert!(action.is_none());

        // Open & Edit
        let (fb, action) = handle_gui_command("gui open foo.scm");
        assert!(fb.contains("Action: open foo.scm"));
        assert_eq!(
            action.unwrap(),
            serde_json::json!({ "type": "gui_action", "action": "open", "file": "foo.scm" })
        );

        // Empty gui open / gui edit defaults to scratch-*.scm
        let (fb, action) = handle_gui_command("gui open");
        assert!(fb.contains("Action: open scratch-"));
        let act = action.unwrap();
        assert_eq!(act["type"], "gui_action");
        assert_eq!(act["action"], "open");
        assert!(act["file"].as_str().unwrap().starts_with("scratch-"));
        assert!(act["file"].as_str().unwrap().ends_with(".scm"));

        let (fb, action) = handle_gui_command("gui edit");
        assert!(fb.contains("Action: open scratch-"));
        let act = action.unwrap();
        assert_eq!(act["action"], "open");
        assert!(act["file"].as_str().unwrap().starts_with("scratch-"));

        let (fb, action) = handle_gui_command("gui edit \"src/main.rs\"");
        assert!(fb.contains("Action: open src/main.rs"));
        assert_eq!(
            action.unwrap(),
            serde_json::json!({ "type": "gui_action", "action": "open", "file": "src/main.rs" })
        );

        // Close
        let (fb, action) = handle_gui_command("gui close");
        assert!(fb.contains("Action: close"));
        assert_eq!(
            action.unwrap(),
            serde_json::json!({ "type": "gui_action", "action": "close", "file": "" })
        );

        let (fb, action) = handle_gui_command("gui close test.scm");
        assert!(fb.contains("Action: close test.scm"));
        assert_eq!(
            action.unwrap(),
            serde_json::json!({ "type": "gui_action", "action": "close", "file": "test.scm" })
        );

        // Ratio
        let (fb, action) = handle_gui_command("gui ratio 60:40");
        assert!(fb.contains("Action: ratio 60:40"));
        assert_eq!(
            action.unwrap(),
            serde_json::json!({ "type": "gui_action", "action": "ratio", "left": 60, "right": 40 })
        );

        let (fb, action) = handle_gui_command("gui ratio 70/30");
        assert!(fb.contains("Action: ratio 70:30"));
        assert_eq!(
            action.unwrap(),
            serde_json::json!({ "type": "gui_action", "action": "ratio", "left": 70, "right": 30 })
        );

        // Unknown
        let (fb, action) = handle_gui_command("gui foobar");
        assert!(fb.contains("unknown command"));
        assert!(action.is_none());
    }

    #[tokio::test]
    async fn test_file_api_endpoints() {
        let app = test_app();

        // 1. Write a temporary file via POST /api/file
        let write_payload = serde_json::json!({
            "path": "test_artifacts/example.scm",
            "content": "(define (greet name) (string-append \"Hello, \" name))"
        });
        let req = Request::builder()
            .uri("/api/file")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_string(&write_payload).unwrap()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let write_resp: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(write_resp["ok"], true);

        // 2. Read the file back via GET /api/file?path=...
        let req = Request::builder()
            .uri("/api/file?path=test_artifacts/example.scm")
            .method("GET")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let read_resp: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(read_resp["ok"], true);
        assert_eq!(
            read_resp["content"],
            "(define (greet name) (string-append \"Hello, \" name))"
        );

        // 3. Read a non-existent file
        let req = Request::builder()
            .uri("/api/file?path=does_not_exist_12345.xyz")
            .method("GET")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let err_resp: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(err_resp["ok"], false);

        // Clean up written test file
        let _ = tokio::fs::remove_dir_all(crate::file_api::resolve_path("test_artifacts")).await;
        let _ = tokio::fs::remove_dir_all("test_artifacts").await;
    }

    #[tokio::test]
    async fn test_gui_api_endpoint() {
        let steel_bin = find_steel_binary();
        let steel_version = detect_steel_version(&steel_bin);
        let (gui_broadcast, _) = tokio::sync::broadcast::channel(100);
        let mut rx = gui_broadcast.subscribe();

        let state = Arc::new(AppState {
            steel_bin,
            steel_version,
            static_dir: None,
            serve_embedded: false,
            repl: Arc::new(tokio::sync::Mutex::new(None)),
            eval_counter: Arc::new(AtomicU64::new(1)),
            gui_broadcast,
        });
        let app = create_app(state);

        // POST /api/gui with open
        let req = Request::builder()
            .uri("/api/gui")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"cmd": "open", "args": ["demo.scm"]}"#))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let broadcast_msg = rx.recv().await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&broadcast_msg).unwrap();
        assert_eq!(parsed["type"], "gui_action");
        assert_eq!(parsed["action"], "open");
        assert_eq!(parsed["file"], "demo.scm");

        // POST /api/gui with ratio
        let req = Request::builder()
            .uri("/api/gui")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"cmd": "ratio", "args": ["65:35"]}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let broadcast_msg2 = rx.recv().await.unwrap();
        let parsed2: serde_json::Value = serde_json::from_str(&broadcast_msg2).unwrap();
        assert_eq!(parsed2["type"], "gui_action");
        assert_eq!(parsed2["action"], "ratio");
        assert_eq!(parsed2["left"], 65);
        assert_eq!(parsed2["right"], 35);
    }

    #[test]
    fn test_spawn_pty_bash() {
        use std::io::{Read, Write};
        let (master, mut child) = crate::terminal::spawn_pty("bash", Path::new("steel"), Path::new(".")).unwrap();
        let mut reader = master.try_clone_reader().unwrap();
        let mut writer = master.take_writer().unwrap();

        writeln!(writer, "echo PTY_ECHO_TEST_SUCCESS").unwrap();
        writer.flush().unwrap();

        let mut output = Vec::new();
        let mut buf = [0u8; 1024];
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(10) {
            if let Ok(n) = reader.read(&mut buf) {
                if n > 0 {
                    output.extend_from_slice(&buf[..n]);
                    let s = String::from_utf8_lossy(&output);
                    if s.contains("PTY_ECHO_TEST_SUCCESS") {
                        break;
                    }
                }
            }
        }
        let s = String::from_utf8_lossy(&output);
        assert!(s.contains("PTY_ECHO_TEST_SUCCESS"));
        let _ = child.kill();
    }

    #[test]
    fn test_spawn_pty_steel() {
        use std::io::{Read, Write};
        let steel_bin = find_steel_binary();
        let (master, mut child) = crate::terminal::spawn_pty("steel", &steel_bin, Path::new(".")).unwrap();
        let mut reader = master.try_clone_reader().unwrap();
        let mut writer = master.take_writer().unwrap();

        writeln!(writer, "(+ 123 456)").unwrap();
        writer.flush().unwrap();

        let mut output = Vec::new();
        let mut buf = [0u8; 1024];
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(10) {
            if let Ok(n) = reader.read(&mut buf) {
                if n > 0 {
                    output.extend_from_slice(&buf[..n]);
                    let s = String::from_utf8_lossy(&output);
                    if s.contains("579") {
                        break;
                    }
                }
            }
        }
        let s = String::from_utf8_lossy(&output);
        assert!(s.contains("579"), "Expected Steel REPL output to evaluate (+ 123 456) to 579, got: {}", s);
        let _ = child.kill();
    }

    #[tokio::test]
    async fn test_ws_terminal_full_integration() {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;

        let steel_bin = find_steel_binary();
        let steel_version = detect_steel_version(&steel_bin);
        let (gui_broadcast, _) = tokio::sync::broadcast::channel(100);

        let state = Arc::new(AppState {
            steel_bin,
            steel_version,
            static_dir: None,
            serve_embedded: false,
            repl: Arc::new(tokio::sync::Mutex::new(None)),
            eval_counter: Arc::new(AtomicU64::new(1)),
            gui_broadcast,
        });
        let app = create_app(state);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let ws_url = format!("ws://{}/ws/terminal?tab_id=test_tab&cmd=bash", addr);
        let (mut ws_stream, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();

        // Send resize message
        ws_stream
            .send(TungsteniteMessage::Text(
                r#"{"type": "resize", "cols": 120, "rows": 40}"#.to_string(),
            ))
            .await
            .unwrap();

        // Send intercepted gui command: gui open test_live.scm\r
        ws_stream
            .send(TungsteniteMessage::Text("gui open test_live.scm\r".to_string()))
            .await
            .unwrap();

        let start = Instant::now();
        let mut got_gui_feedback = false;
        let mut got_gui_broadcast = false;

        while start.elapsed() < Duration::from_secs(10) {
            match tokio::time::timeout(Duration::from_millis(500), ws_stream.next()).await {
                Ok(Some(Ok(msg))) => match msg {
                    TungsteniteMessage::Binary(bin) => {
                        let s = String::from_utf8_lossy(&bin);
                        if s.contains("[GUI]") && s.contains("test_live.scm") {
                            got_gui_feedback = true;
                        }
                    }
                    TungsteniteMessage::Text(txt) => {
                        if txt.contains("gui_action") && txt.contains("test_live.scm") {
                            got_gui_broadcast = true;
                        }
                    }
                    _ => {}
                },
                _ => {}
            }
            if got_gui_feedback && got_gui_broadcast {
                break;
            }
        }

        assert!(got_gui_feedback, "Should have received formatted GUI feedback in terminal stream");
        assert!(got_gui_broadcast, "Should have received JSON gui_action broadcast on WebSocket");
    }
}
