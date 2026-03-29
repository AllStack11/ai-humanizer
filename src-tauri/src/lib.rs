use chrono::Utc;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

const DEFAULT_CHAT_COMPLETIONS_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const LOG_LIMIT: usize = 250;
const DEFAULT_SECRET_DIR_NAME: &str = ".voice-humanizer";
const API_KEY_FILE_NAME: &str = "openrouter_api_key";
const DEFAULT_DEBUG_LOG_FILE_NAME: &str = "openrouter-debug.log";

fn runtime_channel() -> &'static str {
  if cfg!(debug_assertions) {
    "debug"
  } else {
    "release"
  }
}

#[derive(Default)]
struct AppState {
  logs: Mutex<Vec<RequestLog>>,
  seq: AtomicU64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct ChatMessage {
  role: String,
  content: String,
}

#[derive(Debug, Deserialize, Clone)]
struct OpenRouterPayload {
  model: String,
  system: Option<String>,
  messages: Option<Vec<ChatMessage>>,
  max_tokens: Option<u32>,
  temperature: Option<f64>,
  frequency_penalty: Option<f64>,
  response_format: Option<Value>,
  stream: Option<bool>,
}

#[derive(Debug, Serialize)]
struct ContentItem {
  text: String,
}

#[derive(Debug, Serialize)]
struct OpenRouterResult {
  content: Vec<ContentItem>,
  usage: Option<Value>,
}

#[allow(non_snake_case)]
#[derive(Debug, Serialize, Clone)]
struct StreamEventPayload {
  requestId: String,
  chunk: Option<String>,
  fullText: String,
  done: bool,
  error: Option<String>,
}

#[allow(non_snake_case)]
#[derive(Debug, Serialize, Clone)]
struct RequestLog {
  id: String,
  startedAt: String,
  route: String,
  stream: bool,
  model: String,
  request: Value,
  status: String,
  durationMs: Option<u128>,
  usage: Option<Value>,
  responsePreview: String,
  error: Option<String>,
}

#[derive(Debug, Serialize)]
struct RequestLogsResponse {
  logs: Vec<RequestLog>,
  count: usize,
}

#[derive(Debug, Serialize)]
struct OkResponse {
  ok: bool,
}

#[derive(Debug, Deserialize)]
struct DiagnosticLogPayload {
  route: String,
  status: Option<String>,
  stream: Option<bool>,
  model: Option<String>,
  request: Option<Value>,
  response_preview: Option<String>,
  error: Option<String>,
}

#[derive(Debug, Serialize)]
struct ApiKeyStatusResponse {
  #[serde(rename = "hasKey")]
  has_key: bool,
  source: String,
}

#[derive(Debug, Deserialize, Clone, Default)]
struct RuntimeConfig {
  api_url: Option<String>,
  api_key_file: Option<String>,
}

#[allow(non_snake_case)]
#[derive(Debug, Serialize)]
struct StylesBackupResponse {
  styles: Value,
  savedAt: Option<String>,
  path: String,
}

#[allow(non_snake_case)]
#[derive(Debug, Serialize)]
struct SaveStylesResponse {
  ok: bool,
  savedAt: String,
  path: String,
}

fn now_iso() -> String {
  Utc::now().to_rfc3339()
}

fn parse_dotenv_line_for_key(line: &str, key: &str) -> Option<Option<String>> {
  let trimmed = line.trim();
  if trimmed.is_empty() || trimmed.starts_with('#') {
    return None;
  }

  let without_export = trimmed.strip_prefix("export ").unwrap_or(trimmed);
  let (k, v) = without_export.split_once('=')?;
  if k.trim() != key {
    return None;
  }

  let mut value = v.trim();
  if !value.starts_with('"') && !value.starts_with('\'') {
    value = value.split('#').next().unwrap_or(value).trim();
  }

  let parsed = value.trim_matches('"').trim_matches('\'').trim().to_string();
  if parsed.is_empty() {
    Some(None)
  } else {
    Some(Some(parsed))
  }
}

fn candidate_env_paths() -> Vec<PathBuf> {
  let mut paths: Vec<PathBuf> = Vec::new();
  if let Ok(cwd) = env::current_dir() {
    for ancestor in cwd.ancestors() {
      paths.push(ancestor.join(".env"));
      if ancestor.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        if let Some(parent) = ancestor.parent() {
          paths.push(parent.join(".env"));
        }
      }
    }
  }

  if let Ok(exe_path) = env::current_exe() {
    for ancestor in exe_path.ancestors() {
      paths.push(ancestor.join(".env"));
    }
  }

  let mut deduped = Vec::new();
  for path in paths {
    if !deduped.contains(&path) {
      deduped.push(path);
    }
  }
  deduped
}

fn parse_env_file_key(key: &str) -> Option<String> {
  for env_path in candidate_env_paths() {
    let text = match fs::read_to_string(&env_path) {
      Ok(content) => content,
      Err(_) => continue,
    };
    let lines: Vec<&str> = text.lines().collect();
    for (idx, line) in lines.iter().enumerate() {
      if let Some(found) = parse_dotenv_line_for_key(line, key) {
        if let Some(value) = found {
          return Some(value);
        }
        for next in lines.iter().skip(idx + 1) {
          let next_trimmed = next.trim();
          if next_trimmed.is_empty() || next_trimmed.starts_with('#') {
            continue;
          }
          if next_trimmed.contains('=') {
            break;
          }
          let value = next_trimmed.trim_matches('"').trim_matches('\'').trim();
          if !value.is_empty() {
            return Some(value.to_string());
          }
          break;
        }
      }
    }
  }
  None
}

fn env_or_dotenv(key: &str) -> Option<String> {
  std::env::var(key)
    .ok()
    .filter(|v| !v.trim().is_empty())
    .or_else(|| parse_env_file_key(key))
}

fn resolve_chat_completions_url(runtime: Option<&RuntimeConfig>) -> String {
  if let Some(url) = runtime
    .and_then(|cfg| cfg.api_url.as_ref())
    .map(|v| v.trim().to_string())
    .filter(|v| !v.is_empty())
  {
    return url;
  }
  env_or_dotenv("OPENROUTER_API_URL").unwrap_or_else(|| DEFAULT_CHAT_COMPLETIONS_URL.to_string())
}

fn endpoint_requires_api_key(url: &str) -> bool {
  let lower = url.trim().to_ascii_lowercase();
  !(lower.contains("://localhost")
    || lower.contains("://127.0.0.1")
    || lower.contains("://[::1]"))
}

fn resolve_api_key_file_path(app: Option<&tauri::AppHandle>, runtime: Option<&RuntimeConfig>) -> Result<PathBuf, String> {
  let runtime_override = runtime
    .and_then(|cfg| cfg.api_key_file.as_ref())
    .map(|v| v.trim().to_string())
    .filter(|v| !v.is_empty());

  if let Some(raw_path) = runtime_override.or_else(|| env_or_dotenv("OPENROUTER_API_KEY_FILE")) {
    let configured = PathBuf::from(raw_path.trim());
    if configured.is_absolute() {
      return Ok(configured);
    }
    let cwd = env::current_dir().map_err(|e| format!("Failed to resolve current dir: {e}"))?;
    return Ok(cwd.join(configured));
  }

  if let Some(app_handle) = app {
    let dir = app_handle
      .path()
      .app_data_dir()
      .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    return Ok(dir.join("secrets").join(API_KEY_FILE_NAME));
  }

  let cwd = env::current_dir().map_err(|e| format!("Failed to resolve current dir: {e}"))?;
  Ok(cwd.join(DEFAULT_SECRET_DIR_NAME).join(API_KEY_FILE_NAME))
}

fn resolve_debug_log_path() -> PathBuf {
  if let Some(custom_path) = env_or_dotenv("OPENROUTER_DEBUG_LOG_PATH") {
    let configured = PathBuf::from(custom_path.trim());
    if configured.is_absolute() {
      return configured;
    }
    if let Ok(cwd) = env::current_dir() {
      return cwd.join(configured);
    }
  }

  if let Ok(cwd) = env::current_dir() {
    return cwd
      .join(DEFAULT_SECRET_DIR_NAME)
      .join("logs")
      .join(DEFAULT_DEBUG_LOG_FILE_NAME);
  }

  PathBuf::from(DEFAULT_SECRET_DIR_NAME)
    .join("logs")
    .join(DEFAULT_DEBUG_LOG_FILE_NAME)
}

fn append_debug_log(line: &str) {
  let path = resolve_debug_log_path();
  if let Some(parent) = path.parent() {
    let _ = fs::create_dir_all(parent);
  }

  let mut safe_line = line.replace('\r', "\\r").replace('\n', "\\n");
  // Redact potential Bearer tokens or API keys from logs
  if safe_line.contains("Bearer ") {
    if let Some(idx) = safe_line.find("Bearer ") {
      let end = safe_line[idx + 7..]
        .find(' ')
        .map(|i| idx + 7 + i)
        .unwrap_or(safe_line.len());
      safe_line.replace_range(idx + 7..end, "<REDACTED>");
    }
  }

  if safe_line.len() > 4000 {
    safe_line.truncate(4000);
    safe_line.push_str("...<truncated>");
  }

  let record = format!("{} {}\n", now_iso(), safe_line);
  let _ = fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(path)
    .and_then(|mut file| std::io::Write::write_all(&mut file, record.as_bytes()));
}

fn read_api_key_from_file(path: &Path) -> Result<Option<String>, String> {
  if !path.exists() {
    return Ok(None);
  }

  let value = fs::read_to_string(path).map_err(|e| format!("Failed reading API key file: {e}"))?;
  let trimmed = value.trim().to_string();
  if trimmed.is_empty() {
    Ok(None)
  } else {
    Ok(Some(trimmed))
  }
}

fn write_api_key_to_file(path: &Path, key: &str) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("Failed creating secrets directory: {e}"))?;
  }
  fs::write(path, key).map_err(|e| format!("Failed writing API key file: {e}"))?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let perms = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, perms).map_err(|e| format!("Failed setting API key file permissions: {e}"))?;
  }
  Ok(())
}

fn clear_api_key_file(path: &Path) -> Result<(), String> {
  if !path.exists() {
    return Ok(());
  }
  fs::remove_file(path).map_err(|e| format!("Failed clearing API key file: {e}"))
}

fn resolve_api_key_with_source(app: Option<&tauri::AppHandle>, runtime: Option<&RuntimeConfig>) -> Result<(Option<String>, &'static str), String> {
  let file_path = resolve_api_key_file_path(app, runtime)?;
  if let Some(from_file) = read_api_key_from_file(&file_path)? {
    return Ok((Some(from_file), "local_file"));
  }
  if let Some(from_env) = env_or_dotenv("OPENROUTER_API_KEY") {
    return Ok((Some(from_env), "env"));
  }
  Ok((None, "missing"))
}

fn resolve_api_key(app: Option<&tauri::AppHandle>, runtime: Option<&RuntimeConfig>) -> Result<Option<String>, String> {
  let (key, _) = resolve_api_key_with_source(app, runtime)?;
  Ok(key)
}

#[tauri::command]
fn has_api_key(app: tauri::AppHandle, runtime: Option<RuntimeConfig>) -> Result<bool, String> {
  let url = resolve_chat_completions_url(runtime.as_ref());
  if !endpoint_requires_api_key(&url) {
    return Ok(true);
  }
  Ok(resolve_api_key(Some(&app), runtime.as_ref())?.is_some())
}

#[tauri::command]
fn get_api_key_status(app: tauri::AppHandle, runtime: Option<RuntimeConfig>) -> Result<ApiKeyStatusResponse, String> {
  let url = resolve_chat_completions_url(runtime.as_ref());
  if !endpoint_requires_api_key(&url) {
    return Ok(ApiKeyStatusResponse {
      has_key: true,
      source: "not_required".to_string(),
    });
  }

  let (key, source) = resolve_api_key_with_source(Some(&app), runtime.as_ref())?;
  Ok(ApiKeyStatusResponse {
    has_key: key.is_some(),
    source: source.to_string(),
  })
}

#[tauri::command]
fn set_api_key(app: tauri::AppHandle, key: String, runtime: Option<RuntimeConfig>) -> Result<OkResponse, String> {
  let trimmed = key.trim();
  if trimmed.is_empty() {
    return Err("API key cannot be empty.".to_string());
  }

  let path = resolve_api_key_file_path(Some(&app), runtime.as_ref())?;
  write_api_key_to_file(&path, trimmed)?;
  Ok(OkResponse { ok: true })
}

#[tauri::command]
fn clear_api_key(app: tauri::AppHandle, runtime: Option<RuntimeConfig>) -> Result<OkResponse, String> {
  let path = resolve_api_key_file_path(Some(&app), runtime.as_ref())?;
  clear_api_key_file(&path)?;
  Ok(OkResponse { ok: true })
}

#[tauri::command]
fn read_clipboard_text() -> Result<String, String> {
  let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("Failed to access clipboard: {e}"))?;
  clipboard
    .get_text()
    .map_err(|e| format!("Failed to read clipboard text: {e}"))
}

fn app_data_backup_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  Ok(dir.join(format!("writer-style-backup.{}.json", runtime_channel())))
}

fn app_data_backup_cleanup_paths(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  let mut paths = Vec::new();
  let base_names = vec![
    "writer-style-backup.json".to_string(),
    "writer-style-backup.debug.json".to_string(),
    "writer-style-backup.release.json".to_string(),
  ];
  for name in base_names {
    let primary = dir.join(&name);
    paths.push(primary.clone());
    let primary_str = primary.to_string_lossy();
    paths.push(PathBuf::from(primary_str.replace(".json", ".1.json")));
    paths.push(PathBuf::from(primary_str.replace(".json", ".2.json")));
  }
  Ok(paths)
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
  if !path.exists() {
    return Ok(());
  }
  fs::remove_file(path).map_err(|e| format!("Failed removing {}: {e}", path.display()))
}

#[tauri::command]
fn get_runtime_channel() -> String {
  runtime_channel().to_string()
}

fn rotate_backups(primary_path: &Path) -> Result<(), String> {
  let path_str = primary_path.to_string_lossy();
  let backup_1 = PathBuf::from(path_str.replace(".json", ".1.json"));
  let backup_2 = PathBuf::from(path_str.replace(".json", ".2.json"));

  if backup_1.exists() {
    fs::copy(&backup_1, &backup_2).map_err(|e| format!("Failed rotating backup .1 -> .2: {e}"))?;
  }
  if primary_path.exists() {
    fs::copy(primary_path, &backup_1).map_err(|e| format!("Failed rotating primary -> .1: {e}"))?;
  }

  Ok(())
}

fn add_log_entry(state: &State<'_, AppState>, payload: &OpenRouterPayload) -> String {
  let seq = state.seq.fetch_add(1, Ordering::Relaxed);
  let id = format!("{}-{}", Utc::now().timestamp_millis(), seq);

  let mut logs = state.logs.lock().expect("log mutex poisoned");
  logs.insert(
    0,
    RequestLog {
      id: id.clone(),
      startedAt: now_iso(),
      route: "tauri:openrouter".to_string(),
      stream: payload.stream.unwrap_or(false),
      model: payload.model.clone(),
      request: json!({
        "system": payload.system.clone().unwrap_or_default(),
        "messages": payload.messages.clone().unwrap_or_default(),
        "max_tokens": payload.max_tokens,
        "temperature": payload.temperature,
      }),
      status: "started".to_string(),
      durationMs: None,
      usage: None,
      responsePreview: String::new(),
      error: None,
    },
  );

  if logs.len() > LOG_LIMIT {
    logs.truncate(LOG_LIMIT);
  }

  id
}

fn update_log_entry(state: &State<'_, AppState>, id: &str, patch: Value) {
  let mut logs = state.logs.lock().expect("log mutex poisoned");
  if let Some(log) = logs.iter_mut().find(|entry| entry.id == id) {
    if let Some(status) = patch.get("status").and_then(Value::as_str) {
      log.status = status.to_string();
    }
    if let Some(duration) = patch.get("durationMs").and_then(Value::as_u64) {
      log.durationMs = Some(duration as u128);
    }
    if let Some(usage) = patch.get("usage") {
      log.usage = if usage.is_null() { None } else { Some(usage.clone()) };
    }
    if let Some(preview) = patch.get("responsePreview").and_then(Value::as_str) {
      log.responsePreview = preview.to_string();
    }
    if let Some(error) = patch.get("error").and_then(Value::as_str) {
      log.error = Some(error.to_string());
    }
  }
}

fn extract_text(openrouter_response: &Value) -> String {
  // Try content.text format (some OpenRouter responses)
  if let Some(text) = openrouter_response
    .get("content")
    .and_then(Value::as_array)
    .and_then(|arr| arr.first())
    .and_then(|x| x.get("text"))
    .and_then(Value::as_str)
  {
    return text.to_string();
  }

  // Try choices[0].message.content as string (standard OpenAI format)
  if let Some(text) = openrouter_response
    .get("choices")
    .and_then(Value::as_array)
    .and_then(|arr| arr.first())
    .and_then(|choice| choice.get("message"))
    .and_then(|msg| msg.get("content"))
    .and_then(Value::as_str)
  {
    return text.to_string();
  }

  // Try choices[0].message.content as array (multi-modal)
  if let Some(parts) = openrouter_response
    .get("choices")
    .and_then(Value::as_array)
    .and_then(|arr| arr.first())
    .and_then(|choice| choice.get("message"))
    .and_then(|msg| msg.get("content"))
    .and_then(Value::as_array)
  {
    let mut full = String::new();
    for part in parts {
      if let Some(text) = part.get("text").and_then(Value::as_str) {
        full.push_str(text);
      }
    }
    if !full.is_empty() {
      return full;
    }
  }

  // Try choices[0].text directly (some older or alternative formats)
  if let Some(text) = openrouter_response
    .get("choices")
    .and_then(Value::as_array)
    .and_then(|arr| arr.first())
    .and_then(|choice| choice.get("text"))
    .and_then(Value::as_str)
  {
    return text.to_string();
  }

  // Debug: log the structure if we can't extract text
  let response_str = serde_json::to_string(openrouter_response).unwrap_or_else(|_| "invalid json".to_string());
  if response_str.len() > 500 {
    let truncated = &response_str[..500];
    append_debug_log(&format!("extract_text: could not extract text from response (truncated): {}", truncated));
  } else {
    append_debug_log(&format!("extract_text: could not extract text from response: {}", response_str));
  }

  String::new()
}

fn extract_stream_text_chunk(openrouter_response: &Value) -> String {
  let choice = openrouter_response
    .get("choices")
    .and_then(Value::as_array)
    .and_then(|arr| arr.first());
  let Some(choice) = choice else {
    // Debug: log the structure if there's no choices array
    let response_str = serde_json::to_string(openrouter_response).unwrap_or_else(|_| "invalid json".to_string());
    if response_str.len() > 500 {
      let truncated = &response_str[..500];
      append_debug_log(&format!("extract_stream_text_chunk: no choices array in response (truncated): {}", truncated));
    } else {
      append_debug_log(&format!("extract_stream_text_chunk: no choices array in response: {}", response_str));
    }
    return String::new();
  };

  // Try delta.content (streaming response)
  let delta = choice.get("delta");
  if let Some(delta) = delta {
    // Check delta.content as string
    if let Some(text) = delta.get("content").and_then(Value::as_str) {
      return text.to_string();
    }
    // Check delta.content as array
    if let Some(parts) = delta.get("content").and_then(Value::as_array) {
      return parts
        .iter()
        .filter_map(|p| p.get("text").and_then(Value::as_str))
        .collect::<String>();
    }
    // Some models might have text directly in delta
    if let Some(text) = delta.get("text").and_then(Value::as_str) {
      return text.to_string();
    }
    // Some models might have content directly as a string in delta
    if let Some(text) = delta.as_str() {
      return text.to_string();
    }
  }

  // Try choice.text directly (some models might put text at choice level)
  if let Some(text) = choice.get("text").and_then(Value::as_str) {
    return text.to_string();
  }

  // Try choice.content directly (some models might put content at choice level)
  if let Some(text) = choice.get("content").and_then(Value::as_str) {
    return text.to_string();
  }
  if let Some(parts) = choice.get("content").and_then(Value::as_array) {
    return parts
      .iter()
      .filter_map(|p| p.get("text").and_then(Value::as_str))
      .collect::<String>();
  }

  // Try message.content (non-streaming or final response)
  let message = choice.get("message");
  if let Some(message) = message {
    // Check message.content as string
    if let Some(text) = message.get("content").and_then(Value::as_str) {
      return text.to_string();
    }
    // Check message.content as array
    if let Some(parts) = message.get("content").and_then(Value::as_array) {
      return parts
        .iter()
        .filter_map(|p| p.get("text").and_then(Value::as_str))
        .collect::<String>();
    }
    // Some models might have text directly in message
    if let Some(text) = message.get("text").and_then(Value::as_str) {
      return text.to_string();
    }
  }

  // Debug: log the structure if we can't extract text
  let response_str = serde_json::to_string(openrouter_response).unwrap_or_else(|_| "invalid json".to_string());
  if response_str.len() > 500 {
    let truncated = &response_str[..500];
    append_debug_log(&format!("extract_stream_text_chunk: could not extract text from response (truncated): {}", truncated));
  } else {
    append_debug_log(&format!("extract_stream_text_chunk: could not extract text from response: {}", response_str));
  }

  String::new()
}

#[tauri::command]
async fn openrouter_chat(
  payload: OpenRouterPayload,
  app: tauri::AppHandle,
  runtime: Option<RuntimeConfig>,
  state: State<'_, AppState>,
) -> Result<OpenRouterResult, String> {
  let chat_url = resolve_chat_completions_url(runtime.as_ref());
  let requires_api_key = endpoint_requires_api_key(&chat_url);
  let api_key = if requires_api_key {
    Some(resolve_api_key(Some(&app), runtime.as_ref())?.ok_or_else(|| {
      if cfg!(debug_assertions) {
        "OpenRouter API key not found. Set it in app settings or OPENROUTER_API_KEY / OPENROUTER_API_KEY_FILE in .env.".to_string()
      } else {
        "OpenRouter API key not found. Open app settings and save your key.".to_string()
      }
    })?)
  } else {
    resolve_api_key(Some(&app), runtime.as_ref())?
  };

  let model = payload.model.trim().to_string();
  if model.is_empty() {
    return Err("Request requires model (selected in App).".to_string());
  }

  let mut messages: Vec<ChatMessage> = vec![];
  if let Some(system) = payload.system.clone() {
    if !system.trim().is_empty() {
      messages.push(ChatMessage {
        role: "system".to_string(),
        content: system.trim().to_string(),
      });
    }
  }
  if let Some(user_messages) = payload.messages.clone() {
    messages.extend(user_messages);
  }
  if messages.is_empty() {
    return Err("Request requires at least one message or system prompt.".to_string());
  }

  append_debug_log(&format!(
    "openrouter_chat start model={} url={} message_count={} system_len={}",
    model,
    chat_url,
    messages.len(),
    payload.system.as_ref().map(|s| s.len()).unwrap_or(0)
  ));

  let log_id = add_log_entry(&state, &payload);
  let started = std::time::Instant::now();

  let app_url = env_or_dotenv("OPENROUTER_APP_URL").unwrap_or_else(|| "http://localhost:5173".to_string());
  let app_name = env_or_dotenv("OPENROUTER_APP_NAME").unwrap_or_else(|| "Voice Humanizer".to_string());
  let categories = env_or_dotenv("OPENROUTER_CATEGORIES").unwrap_or_default();

  let mut headers = HeaderMap::new();
  if let Some(key) = api_key {
    headers.insert(
      AUTHORIZATION,
      HeaderValue::from_str(&format!("Bearer {}", key)).map_err(|e| e.to_string())?,
    );
  }
  headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
  headers.insert(
    "HTTP-Referer",
    HeaderValue::from_str(&app_url).map_err(|e| e.to_string())?,
  );
  headers.insert("X-Title", HeaderValue::from_str(&app_name).map_err(|e| e.to_string())?);
  if !categories.trim().is_empty() {
    headers.insert(
      "X-Categories",
      HeaderValue::from_str(categories.trim()).map_err(|e| e.to_string())?,
    );
  }

  let client = reqwest::Client::new();
  let mut request_body = json!({
    "model": model,
    "messages": messages,
    "max_tokens": payload.max_tokens.unwrap_or(2400).min(32000),
    "temperature": payload.temperature.map(|t| t.max(0.0).min(2.0)),
  });
  if let Some(fp) = payload.frequency_penalty {
    request_body["frequency_penalty"] = json!(fp);
  }
  if let Some(rf) = &payload.response_format {
    request_body["response_format"] = rf.clone();
  }

  let response = client
    .post(&chat_url)
    .headers(headers)
    .json(&request_body)
    .send()
    .await
    .map_err(|e| {
      let msg = format!("Failed to reach OpenRouter: {e}");
      append_debug_log(&format!("openrouter_chat network_error model={} error={}", model, msg));
      update_log_entry(
        &state,
        &log_id,
        json!({
          "status": "failed",
          "durationMs": started.elapsed().as_millis() as u64,
          "error": msg,
        }),
      );
      msg
    })?;

  if !response.status().is_success() {
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    let body_preview = body.chars().take(1200).collect::<String>();
    append_debug_log(&format!(
      "openrouter_chat http_error model={} status={} body_preview={}",
      model, status, body_preview
    ));
    let message = serde_json::from_str::<Value>(&body)
      .ok()
      .and_then(|v| {
        v.get("error")
          .and_then(|e| e.get("message"))
          .and_then(Value::as_str)
          .map(|s| s.to_string())
      })
      .unwrap_or_else(|| format!("OpenRouter returned HTTP {status}"));

    update_log_entry(
      &state,
      &log_id,
      json!({
        "status": "failed",
        "durationMs": started.elapsed().as_millis() as u64,
        "error": message,
      }),
    );

    return Err(message);
  }

  let body = response
    .json::<Value>()
    .await
    .map_err(|e| {
      let msg = format!("Failed to parse OpenRouter response: {e}");
      append_debug_log(&format!("openrouter_chat parse_error model={} error={}", model, msg));
      msg
    })?;

  let text = extract_text(&body);
  let usage = body.get("usage").cloned();
  let preview = text.chars().take(500).collect::<String>();

  update_log_entry(
    &state,
    &log_id,
    json!({
      "status": "completed",
      "durationMs": started.elapsed().as_millis() as u64,
      "usage": usage,
      "responsePreview": preview,
    }),
  );
  append_debug_log(&format!(
    "openrouter_chat completed model={} chars={} usage_present={}",
    model,
    text.len(),
    usage.is_some()
  ));

  Ok(OpenRouterResult {
    content: vec![ContentItem { text }],
    usage,
  })
}

#[tauri::command]
async fn openrouter_chat_stream(
  request_id: String,
  payload: OpenRouterPayload,
  app: tauri::AppHandle,
  runtime: Option<RuntimeConfig>,
  state: State<'_, AppState>,
) -> Result<OkResponse, String> {
  let chat_url = resolve_chat_completions_url(runtime.as_ref());
  let requires_api_key = endpoint_requires_api_key(&chat_url);
  let api_key = if requires_api_key {
    Some(resolve_api_key(Some(&app), runtime.as_ref())?.ok_or_else(|| {
      if cfg!(debug_assertions) {
        "OpenRouter API key not found. Set it in app settings or OPENROUTER_API_KEY / OPENROUTER_API_KEY_FILE in .env.".to_string()
      } else {
        "OpenRouter API key not found. Open app settings and save your key.".to_string()
      }
    })?)
  } else {
    resolve_api_key(Some(&app), runtime.as_ref())?
  };

  let model = payload.model.trim().to_string();
  if model.is_empty() {
    return Err("Request requires model (selected in App).".to_string());
  }

  let mut messages: Vec<ChatMessage> = vec![];
  if let Some(system) = payload.system.clone() {
    if !system.trim().is_empty() {
      messages.push(ChatMessage {
        role: "system".to_string(),
        content: system.trim().to_string(),
      });
    }
  }
  if let Some(user_messages) = payload.messages.clone() {
    messages.extend(user_messages);
  }
  if messages.is_empty() {
    return Err("Request requires at least one message or system prompt.".to_string());
  }

  append_debug_log(&format!(
    "openrouter_chat_stream start request_id={} model={} url={} message_count={} system_len={}",
    request_id,
    model,
    chat_url,
    messages.len(),
    payload.system.as_ref().map(|s| s.len()).unwrap_or(0)
  ));

  let log_id = add_log_entry(&state, &OpenRouterPayload { stream: Some(true), ..payload.clone() });
  let started = std::time::Instant::now();

  let app_url = env_or_dotenv("OPENROUTER_APP_URL").unwrap_or_else(|| "app://voice-humanizer".to_string());
  let app_name = env_or_dotenv("OPENROUTER_APP_NAME").unwrap_or_else(|| "Voice Humanizer".to_string());
  let categories = env_or_dotenv("OPENROUTER_CATEGORIES").unwrap_or_default();

  let mut headers = HeaderMap::new();
  if let Some(key) = api_key {
    headers.insert(
      AUTHORIZATION,
      HeaderValue::from_str(&format!("Bearer {}", key)).map_err(|e| e.to_string())?,
    );
  }
  headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
  headers.insert(
    "HTTP-Referer",
    HeaderValue::from_str(&app_url).map_err(|e| e.to_string())?,
  );
  headers.insert("X-Title", HeaderValue::from_str(&app_name).map_err(|e| e.to_string())?);
  if !categories.trim().is_empty() {
    headers.insert(
      "X-Categories",
      HeaderValue::from_str(categories.trim()).map_err(|e| e.to_string())?,
    );
  }

  let client = reqwest::Client::new();
  let mut request_body = json!({
    "model": model,
    "messages": messages,
    "max_tokens": payload.max_tokens.unwrap_or(2400).min(32000),
    "temperature": payload.temperature.map(|t| t.max(0.0).min(2.0)),
    "stream": true,
  });
  if let Some(fp) = payload.frequency_penalty {
    request_body["frequency_penalty"] = json!(fp);
  }
  if let Some(rf) = &payload.response_format {
    request_body["response_format"] = rf.clone();
  }

  let response = client
    .post(&chat_url)
    .headers(headers)
    .json(&request_body)
    .send()
    .await
    .map_err(|e| {
      let msg = format!("Failed to reach OpenRouter: {e}");
      append_debug_log(&format!(
        "openrouter_chat_stream network_error request_id={} model={} error={}",
        request_id, model, msg
      ));
      update_log_entry(
        &state,
        &log_id,
        json!({
          "status": "failed",
          "durationMs": started.elapsed().as_millis() as u64,
          "error": msg,
        }),
      );
      msg
    })?;

  if !response.status().is_success() {
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    let body_preview = body.chars().take(1200).collect::<String>();
    append_debug_log(&format!(
      "openrouter_chat_stream http_error request_id={} model={} status={} body_preview={}",
      request_id, model, status, body_preview
    ));
    let message = serde_json::from_str::<Value>(&body)
      .ok()
      .and_then(|v| {
        v.get("error")
          .and_then(|e| e.get("message"))
          .and_then(Value::as_str)
          .map(|s| s.to_string())
      })
      .unwrap_or_else(|| format!("OpenRouter returned HTTP {status}"));

    update_log_entry(
      &state,
      &log_id,
      json!({
        "status": "failed",
        "durationMs": started.elapsed().as_millis() as u64,
        "error": message.clone(),
      }),
    );

    let _ = app.emit(
      "openrouter_stream",
      StreamEventPayload {
        requestId: request_id.clone(),
        chunk: None,
        fullText: String::new(),
        done: true,
        error: Some(message.clone()),
      },
    );

    return Err(message);
  }

  let mut bytes_stream = response.bytes_stream();
  let mut buffer = String::new();
  let mut full_text = String::new();
  let mut parse_error_count = 0u32;
  let mut event_count = 0u32;
  let mut chunk_count = 0u32;

  while let Some(next) = bytes_stream.next().await {
    let bytes = next.map_err(|e| {
      let msg = format!("Stream read failed: {e}");
      append_debug_log(&format!(
        "openrouter_chat_stream read_error request_id={} model={} error={}",
        request_id, model, msg
      ));
      msg
    })?;
    buffer.push_str(&String::from_utf8_lossy(&bytes).replace("\r\n", "\n"));

    let mut events: Vec<&str> = buffer.split("\n\n").collect();
    let tail = events.pop().unwrap_or_default().to_string();

    for event in events {
      let data_lines = event
        .lines()
        .filter(|line| line.starts_with("data:"))
        .map(|line| line[5..].trim())
        .collect::<Vec<_>>();

      if data_lines.is_empty() {
        continue;
      }
      event_count += 1;
      let data = data_lines.join("\n");
      if data == "[DONE]" {
        append_debug_log(&format!(
          "openrouter_chat_stream done_marker request_id={} model={}",
          request_id, model
        ));
        continue;
      }

      let payload: Value = match serde_json::from_str(&data) {
        Ok(value) => value,
        Err(e) => {
          parse_error_count += 1;
          let data_preview = data.chars().take(700).collect::<String>();
          append_debug_log(&format!(
            "openrouter_chat_stream sse_parse_error request_id={} model={} error={} data_preview={}",
            request_id, model, e, data_preview
          ));
          continue;
        }
      };

      if let Some(message) = payload
        .get("error")
        .and_then(|err| err.get("message"))
        .and_then(Value::as_str)
      {
        let _ = app.emit(
          "openrouter_stream",
          StreamEventPayload {
            requestId: request_id.clone(),
            chunk: None,
            fullText: full_text.clone(),
            done: true,
            error: Some(message.to_string()),
          },
        );

        update_log_entry(
          &state,
          &log_id,
          json!({
            "status": "failed",
            "durationMs": started.elapsed().as_millis() as u64,
            "error": message,
          }),
        );
        append_debug_log(&format!(
          "openrouter_chat_stream stream_error_event request_id={} model={} message={}",
          request_id, model, message
        ));
        return Err(message.to_string());
      }

      let chunk = extract_stream_text_chunk(&payload);
      if chunk.is_empty() {
        continue;
      }
      chunk_count += 1;
      full_text.push_str(&chunk);

      let _ = app.emit(
        "openrouter_stream",
        StreamEventPayload {
          requestId: request_id.clone(),
          chunk: Some(chunk),
          fullText: full_text.clone(),
          done: false,
          error: None,
        },
      );
    }

    buffer = tail;
  }

  let preview = full_text.chars().take(500).collect::<String>();
  update_log_entry(
    &state,
    &log_id,
    json!({
      "status": "completed",
      "durationMs": started.elapsed().as_millis() as u64,
      "responsePreview": preview,
    }),
  );
  append_debug_log(&format!(
    "openrouter_chat_stream completed request_id={} model={} chars={} events={} chunks={} parse_errors={}",
    request_id,
    model,
    full_text.len(),
    event_count,
    chunk_count,
    parse_error_count
  ));

  let _ = app.emit(
    "openrouter_stream",
    StreamEventPayload {
      requestId: request_id,
      chunk: None,
      fullText: full_text,
      done: true,
      error: None,
    },
  );

  Ok(OkResponse { ok: true })
}

#[tauri::command]
fn get_request_logs(state: State<'_, AppState>) -> RequestLogsResponse {
  let logs = state.logs.lock().expect("log mutex poisoned");
  RequestLogsResponse {
    logs: logs.clone(),
    count: logs.len(),
  }
}

#[tauri::command]
fn clear_request_logs(state: State<'_, AppState>) -> OkResponse {
  let mut logs = state.logs.lock().expect("log mutex poisoned");
  logs.clear();
  OkResponse { ok: true }
}

#[tauri::command]
fn clear_app_data(
  app: tauri::AppHandle,
  runtime: Option<RuntimeConfig>,
  state: State<'_, AppState>,
) -> Result<OkResponse, String> {
  {
    let mut logs = state.logs.lock().expect("log mutex poisoned");
    logs.clear();
  }

  let api_key_path = resolve_api_key_file_path(Some(&app), runtime.as_ref())?;
  clear_api_key_file(&api_key_path)?;

  for path in app_data_backup_cleanup_paths(&app)? {
    remove_if_exists(&path)?;
  }

  let debug_log_path = resolve_debug_log_path();
  let _ = remove_if_exists(&debug_log_path);

  Ok(OkResponse { ok: true })
}

#[tauri::command]
fn add_diagnostic_log(payload: DiagnosticLogPayload, state: State<'_, AppState>) -> Result<OkResponse, String> {
  let route = payload.route.trim().to_string();
  if route.is_empty() {
    return Err("Diagnostic route is required.".to_string());
  }

  let seq = state.seq.fetch_add(1, Ordering::Relaxed);
  let id = format!("{}-{}", Utc::now().timestamp_millis(), seq);

  let mut logs = state.logs.lock().expect("log mutex poisoned");
  logs.insert(
    0,
    RequestLog {
      id,
      startedAt: now_iso(),
      route,
      stream: payload.stream.unwrap_or(false),
      model: payload.model.unwrap_or_else(|| "system".to_string()),
      request: payload.request.unwrap_or_else(|| json!({})),
      status: payload.status.unwrap_or_else(|| "info".to_string()),
      durationMs: None,
      usage: None,
      responsePreview: payload.response_preview.unwrap_or_default(),
      error: payload.error,
    },
  );

  if logs.len() > LOG_LIMIT {
    logs.truncate(LOG_LIMIT);
  }

  Ok(OkResponse { ok: true })
}

#[tauri::command]
fn get_styles_backup(app: tauri::AppHandle) -> Result<StylesBackupResponse, String> {
  let path = app_data_backup_path(&app)?;

  if !path.exists() {
    return Ok(StylesBackupResponse {
      styles: json!({}),
      savedAt: None,
      path: path.display().to_string(),
    });
  }

  let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read backup file: {e}"))?;
  let parsed = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({}));
  let styles = parsed
    .get("styles")
    .filter(|v| v.is_object())
    .cloned()
    .unwrap_or_else(|| json!({}));

  Ok(StylesBackupResponse {
    styles,
    savedAt: parsed
      .get("savedAt")
      .and_then(Value::as_str)
      .map(|s| s.to_string()),
    path: path.display().to_string(),
  })
}

#[tauri::command]
fn save_styles_backup(app: tauri::AppHandle, styles: Value) -> Result<SaveStylesResponse, String> {
  if !styles.is_object() {
    return Err("Invalid styles payload".to_string());
  }

  let path = app_data_backup_path(&app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("Failed to create backup directory: {e}"))?;
  }
  rotate_backups(&path)?;

  let saved_at = now_iso();
  let payload = json!({
    "version": 1,
    "savedAt": saved_at,
    "styles": styles,
  });

  let formatted = serde_json::to_string_pretty(&payload)
    .map_err(|e| format!("Failed to serialize backup payload: {e}"))?;
  let tmp_path = PathBuf::from(format!("{}.tmp", path.to_string_lossy()));
  fs::write(&tmp_path, formatted).map_err(|e| format!("Failed to write temp backup file: {e}"))?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let perms = fs::Permissions::from_mode(0o600);
    let _ = fs::set_permissions(&tmp_path, perms);
  }

  if path.exists() {
    fs::remove_file(&path).map_err(|e| format!("Failed to replace previous backup file: {e}"))?;
  }
  fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to move temp backup into place: {e}"))?;

  Ok(SaveStylesResponse {
    ok: true,
    savedAt: saved_at,
    path: path.display().to_string(),
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().build())
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
      has_api_key,
      get_api_key_status,
      set_api_key,
      clear_api_key,
      read_clipboard_text,
      openrouter_chat,
      openrouter_chat_stream,
      get_styles_backup,
      save_styles_backup,
      get_runtime_channel,
      get_request_logs,
      clear_request_logs,
      clear_app_data,
      add_diagnostic_log,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
