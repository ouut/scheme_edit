use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    response::Json,
};
use serde::Deserialize;

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct FileQuery {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct GuiApiRequest {
    #[serde(alias = "action")]
    pub cmd: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub left: Option<u32>,
    #[serde(default)]
    pub right: Option<u32>,
}

pub fn resolve_path(rel_or_abs: &str) -> PathBuf {
    let p = Path::new(rel_or_abs);
    if p.is_absolute() {
        return p.to_path_buf();
    }
    let base = std::env::var("WORKSPACE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let def = PathBuf::from("/workspace/scheme_edit");
            if def.exists() {
                def
            } else {
                PathBuf::from(".")
            }
        });
    base.join(p)
}

/// GET /api/file?path=<path>
pub async fn read_file_handler(
    Query(params): Query<FileQuery>,
) -> Json<serde_json::Value> {
    if params.path.trim().is_empty() {
        return Json(serde_json::json!({
            "ok": false,
            "error": "Path parameter is required",
            "path": ""
        }));
    }

    let target_path = resolve_path(&params.path);

    match tokio::fs::read_to_string(&target_path).await {
        Ok(content) => Json(serde_json::json!({
            "ok": true,
            "path": params.path,
            "content": content
        })),
        Err(e) => {
            Json(serde_json::json!({
                "ok": false,
                "error": format!("Failed to read file: {e}"),
                "path": params.path
            }))
        }
    }
}

/// POST /api/file
pub async fn write_file_handler(
    Json(payload): Json<WriteFileRequest>,
) -> Json<serde_json::Value> {
    if payload.path.trim().is_empty() {
        return Json(serde_json::json!({
            "ok": false,
            "error": "Path parameter is required",
            "path": ""
        }));
    }

    let target_path = resolve_path(&payload.path);

    if let Some(parent) = target_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return Json(serde_json::json!({
                "ok": false,
                "error": format!("Failed to create parent directory: {e}"),
                "path": payload.path
            }));
        }
    }

    match tokio::fs::write(&target_path, &payload.content).await {
        Ok(_) => Json(serde_json::json!({
            "ok": true,
            "path": payload.path,
            "bytes_written": payload.content.len()
        })),
        Err(e) => Json(serde_json::json!({
            "ok": false,
            "error": format!("Failed to write file: {e}"),
            "path": payload.path
        })),
    }
}

/// POST /api/gui
pub async fn gui_action_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<GuiApiRequest>,
) -> Json<serde_json::Value> {
    let cmd = payload.cmd.trim().to_lowercase();

    static HTTP_ACTION_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(10000);
    let mut action_value = match cmd.as_str() {
        "open" | "edit" => {
            let file = payload
                .file
                .or_else(|| payload.args.first().cloned())
                .unwrap_or_default();
            serde_json::json!({
                "type": "gui_action",
                "action": "open",
                "file": file
            })
        }
        "close" => {
            let file = payload
                .file
                .or_else(|| payload.args.first().cloned())
                .unwrap_or_default();
            serde_json::json!({
                "type": "gui_action",
                "action": "close",
                "file": file
            })
        }
        "ratio" => {
            let (left, right) = if let (Some(l), Some(r)) = (payload.left, payload.right) {
                (l, r)
            } else if let Some(arg) = payload.args.first() {
                if let Some((l, r)) = arg.split_once(':').or_else(|| arg.split_once('/')) {
                    (
                        l.trim().parse::<u32>().unwrap_or(50),
                        r.trim().parse::<u32>().unwrap_or(50),
                    )
                } else if payload.args.len() >= 2 {
                    (
                        payload.args[0].trim().parse::<u32>().unwrap_or(50),
                        payload.args[1].trim().parse::<u32>().unwrap_or(50),
                    )
                } else {
                    (50, 50)
                }
            } else {
                (50, 50)
            };

            serde_json::json!({
                "type": "gui_action",
                "action": "ratio",
                "left": left,
                "right": right
            })
        }
        _ => {
            serde_json::json!({
                "type": "gui_action",
                "action": cmd,
                "args": payload.args
            })
        }
    };

    let id = HTTP_ACTION_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    action_value["id"] = serde_json::json!(id);

    if let Ok(json_str) = serde_json::to_string(&action_value) {
        let _ = state.gui_broadcast.send(json_str);
    }

    Json(serde_json::json!({
        "ok": true,
        "broadcasted": true,
        "action": action_value
    }))
}
