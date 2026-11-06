use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing::info;

#[derive(Clone)]
pub struct AppState {
    pub steel_bin: PathBuf,
    pub steel_version: String,
    pub static_dir: Option<PathBuf>,
    pub session: Arc<tokio::sync::Mutex<Vec<String>>>,
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

/// Extract top-level (define ...) expressions from code
pub fn extract_definitions(text: &str) -> Vec<String> {
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
                            defs.push(text[start..=j].to_string());
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

    // Locate end of ASCII art banner:
    // The banner ends with `/____/\__/\___/\___/_/`
    let banner_marker = "/____/\\__/\\___/\\___/_/";
    let after_banner = if let Some(idx) = cleaned.find(banner_marker) {
        &cleaned[idx + banner_marker.len()..]
    } else if let Some(idx) = cleaned.find("λ > ") {
        &cleaned[idx..]
    } else {
        &cleaned
    };

    // Replace prompt occurrences with newlines so prompt-separated tokens are cleanly delimited
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

        // Check if line contains an evaluation marker "=> "
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

    let cargo_bin = PathBuf::from("/root/.cargo/bin/steel");
    if cargo_bin.exists() {
        return cargo_bin;
    }

    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(home).join(".cargo/bin/steel");
        if p.exists() {
            return p;
        }
    }

    PathBuf::from("steel")
}

/// Detect steel version by running `steel --version`.
pub fn detect_steel_version(steel_bin: &Path) -> String {
    if let Ok(output) = std::process::Command::new(steel_bin).arg("--version").output() {
        let s = String::from_utf8_lossy(&output.stdout);
        // Output format is typically: "steel 0.8.2\n"
        if let Some(v) = s.trim().strip_prefix("steel ") {
            return v.trim().to_string();
        }
        if !s.trim().is_empty() {
            return s.trim().to_string();
        }
    }
    "0.8.2".to_string()
}

/// Resolve the directory for static file serving.
pub fn resolve_static_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("STATIC_DIR") {
        let p = PathBuf::from(dir);
        if p.exists() {
            return Some(p);
        }
    }

    let default_dist = PathBuf::from("../frontend/dist");
    if default_dist.exists() {
        return Some(default_dist);
    }

    let static_dir = PathBuf::from("./static");
    if static_dir.exists() {
        return Some(static_dir);
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
    let mut session = state.session.lock().await;
    session.clear();
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

    let start = Instant::now();
    let trimmed_code = code.trim();
    let is_definition = trimmed_code.starts_with("(define");

    // Build context with definitions to prepend
    let mut prepended_defs = String::new();

    // 1. Session definitions
    {
        let session = state.session.lock().await;
        for def in session.iter() {
            prepended_defs.push_str(def);
            prepended_defs.push('\n');
        }
    }

    // 2. Buffer definitions (if buffer is provided)
    if let Some(ref buffer) = payload.buffer {
        let buffer_defs = extract_definitions(buffer);
        for def in buffer_defs {
            if def.trim() == trimmed_code {
                continue;
            }
            if !prepended_defs.contains(&def) {
                prepended_defs.push_str(&def);
                prepended_defs.push('\n');
            }
        }
    }

    let full_code = if prepended_defs.is_empty() {
        code.clone()
    } else {
        format!("{}\n{}", prepended_defs, code)
    };

    let mut cmd = Command::new(&state.steel_bin);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            return Json(EvalResponse {
                ok: false,
                result: String::new(),
                stdout: String::new(),
                stderr: format!("Failed to spawn steel process: {e}"),
                duration_ms,
            });
        }
    };

    // Pipe code to child stdin asynchronously
    if let Some(mut stdin) = child.stdin.take() {
        let code_bytes = full_code.as_bytes().to_vec();
        tokio::spawn(async move {
            let _ = stdin.write_all(&code_bytes).await;
            let _ = stdin.write_all(b"\n").await;
            let _ = stdin.flush().await;
            drop(stdin);
        });
    }

    // Wait with 5 second timeout
    let timeout_duration = Duration::from_secs(5);
    let wait_res = tokio::time::timeout(timeout_duration, child.wait_with_output()).await;

    match wait_res {
        Err(_elapsed) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            Json(EvalResponse {
                ok: false,
                result: String::new(),
                stdout: String::new(),
                stderr: "Execution timed out (5s limit)".to_string(),
                duration_ms,
            })
        }
        Ok(Err(e)) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            Json(EvalResponse {
                ok: false,
                result: String::new(),
                stdout: String::new(),
                stderr: format!("Process execution error: {e}"),
                duration_ms,
            })
        }
        Ok(Ok(output)) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            let raw_stdout = String::from_utf8_lossy(&output.stdout);
            let raw_stderr = String::from_utf8_lossy(&output.stderr);

            let (stdout, mut result) = parse_repl_output(&raw_stdout);
            let mut stderr_cleaned = strip_ansi(&raw_stderr).trim().to_string();

            // If REPL returned no output, no result, and no error, check if input has an unclosed delimiter
            if result.is_empty()
                && stdout.is_empty()
                && stderr_cleaned.is_empty()
                && has_unclosed_delimiter(&code)
            {
                if let Ok(mut temp) = tempfile::Builder::new().suffix(".scm").tempfile() {
                    use std::io::Write;
                    let _ = temp.write_all(code.as_bytes());
                    let _ = temp.flush();
                    if let Ok(check_output) =
                        std::process::Command::new(&state.steel_bin).arg(temp.path()).output()
                    {
                        let check_err = String::from_utf8_lossy(&check_output.stderr);
                        if !check_err.trim().is_empty() {
                            let temp_path_str = temp.path().to_string_lossy();
                            let clean_err = check_err.replace(&*temp_path_str, "<input>");
                            stderr_cleaned = clean_err.trim().to_string();
                        }
                    }
                }
            }

            let mut ok = output.status.success() && stderr_cleaned.is_empty();
            if !output.status.success() && stderr_cleaned.is_empty() {
                stderr_cleaned = format!("Process exited with status: {}", output.status);
                ok = false;
            } else if !stderr_cleaned.is_empty() {
                ok = false;
            }

            if ok {
                if is_definition {
                    let mut session = state.session.lock().await;
                    session.push(trimmed_code.to_string());
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
        }
        ul {
            list-style: none;
            padding-left: 0;
        }
        li {
            padding: 0.5rem 0;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .tag {
            font-size: 0.75rem;
            font-weight: 700;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
        }
        .tag-get { background: #065f46; color: #6ee7b7; }
        .tag-post { background: #1e40af; color: #93c5fd; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Scheme Editor Backend</h1>
        <p>The Rust server is up and running with embedded <strong>Steel Scheme</strong> support.</p>
        <p>Static frontend build directory was not found. If you are developing the frontend, run the Vite dev server (e.g., on port <code>5173</code>) or build assets into <code>../frontend/dist</code>.</p>
        <div class="endpoints">
            <h2>Available API Endpoints:</h2>
            <ul>
                <li><span class="tag tag-get">GET</span> <code>/api/health</code> &mdash; Check server and Steel interpreter status</li>
                <li><span class="tag tag-post">POST</span> <code>/api/eval</code> &mdash; Evaluate Scheme expressions with Steel</li>
            </ul>
        </div>
    </div>
</body>
</html>"#
}

pub async fn friendly_fallback_handler() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        Html(friendly_fallback_html()),
    )
}

pub fn create_app(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::permissive();

    let router = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/eval", post(eval_handler))
        .route("/api/reset", post(reset_handler));

    let router = if let Some(ref dir) = state.static_dir {
        let index_path = dir.join("index.html");
        if index_path.exists() {
            router.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index_path)))
        } else {
            router.fallback_service(
                ServeDir::new(dir).fallback(axum::routing::get(friendly_fallback_handler)),
            )
        }
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
    tracing_subscriber::fmt::init();

    let steel_bin = find_steel_binary();
    let steel_version = detect_steel_version(&steel_bin);
    let static_dir = resolve_static_dir();

    info!(
        "Scheme Editor Server initializing: steel={:?} version={} static_dir={:?}",
        steel_bin, steel_version, static_dir
    );

    let state = Arc::new(AppState {
        steel_bin,
        steel_version,
        static_dir,
        session: Arc::new(tokio::sync::Mutex::new(Vec::new())),
    });

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind to {addr}: {e}");
            std::process::exit(1);
        }
    };

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
        let state = Arc::new(AppState {
            steel_bin,
            steel_version,
            static_dir: None,
            session: Arc::new(tokio::sync::Mutex::new(Vec::new())),
        });
        create_app(state)
    }

    #[test]
    fn test_strip_ansi() {
        let raw = "\x1b[32mhello\x1b[0m world";
        assert_eq!(strip_ansi(raw), "hello world");
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
        assert_eq!(json["steel"], "0.8.2");
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
        assert!(eval.duration_ms >= 4900);
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
}

