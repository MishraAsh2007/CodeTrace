//! Optional AI assistant: relays chat requests to an OpenAI-compatible endpoint (Ollama on this computer, or a hosted
//! provider the user chose) and streams the answer to the browser. The API key is stored on this computer in
//! .local/ai.json and never sent back to the browser. Off until the user configures it.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Arc}, time::Duration};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::Command, sync::{Mutex, Semaphore}};

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct AiConfig {
    #[serde(default)] pub provider: String,
    #[serde(default)] pub url: String,
    #[serde(default)] pub model: String,
    #[serde(default)] pub key: String,
}

#[derive(Deserialize)]
pub struct ConfigUpdate { pub provider: String, pub url: String, pub model: String, pub key: Option<String> }

#[derive(Clone, Deserialize, Serialize)]
pub struct ChatMessage { pub role: String, pub content: String }

struct Job { text: String, status: &'static str, error: String, cancel: Arc<AtomicBool> }

pub struct Assist {
    path: PathBuf,
    java: PathBuf,
    worker: PathBuf,
    jobs: Mutex<HashMap<String, Arc<Mutex<Job>>>>,
    slots: Arc<Semaphore>,
    next: AtomicU64,
}

/// http is allowed only for this computer (Ollama, LM Studio); anything remote must use https.
pub fn check_url(url: &str) -> Result<(), &'static str> {
    let rest = url.strip_prefix("https://").map(|r| (true, r)).or_else(|| url.strip_prefix("http://").map(|r| (false, r)));
    let Some((secure, rest)) = rest else { return Err("The address must start with https:// (or http:// for a server on this computer).") };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.rsplit_once('@').map(|(_, h)| h).unwrap_or(host);
    let name = if host.starts_with('[') { host.split(']').next().unwrap_or("").trim_start_matches('[') } else { host.split(':').next().unwrap_or("") };
    if name.is_empty() || url.len() > 300 || url.contains(char::is_whitespace) { return Err("Enter a valid address."); }
    if !secure && !["localhost", "127.0.0.1", "::1"].contains(&name) { return Err("Use https:// for a server that isn't on this computer."); }
    Ok(())
}

impl Assist {
    pub fn new(root: &std::path::Path, java: PathBuf) -> Arc<Self> {
        let path = std::env::var_os("TRACELAB_AI_CONFIG").map(PathBuf::from).unwrap_or_else(|| root.join(".local/ai.json"));
        Arc::new(Self { path, java, worker: root.join(".local/worker"), jobs: Mutex::new(HashMap::new()), slots: Arc::new(Semaphore::new(2)), next: AtomicU64::new(1) })
    }

    pub fn load(&self) -> Option<AiConfig> {
        let config: AiConfig = serde_json::from_str(&std::fs::read_to_string(&self.path).ok()?).ok()?;
        (!config.url.is_empty() && !config.model.is_empty()).then_some(config)
    }

    pub fn status(&self) -> Value {
        match self.load() {
            Some(c) => {
                let local = ["://localhost", "://127.0.0.1", "://[::1]"].iter().any(|h| c.url.contains(h));
                json!({"configured": true, "provider": c.provider, "url": c.url, "model": c.model, "hasKey": !c.key.is_empty(), "local": local})
            }
            None => json!({"configured": false}),
        }
    }

    pub fn save(&self, update: ConfigUpdate) -> Result<Value, String> {
        let url = update.url.trim().trim_end_matches('/').to_string();
        check_url(&url)?;
        if update.model.trim().is_empty() || update.model.len() > 200 { return Err("Enter a model name.".into()); }
        if update.provider.len() > 40 { return Err("Unknown provider.".into()); }
        let key = match update.key { Some(k) if !k.trim().is_empty() => k.trim().to_string(), Some(_) => String::new(), None => self.load().map(|c| c.key).unwrap_or_default() };
        if key.len() > 400 || key.contains(['\r', '\n']) { return Err("That API key doesn't look right.".into()); }
        let config = AiConfig { provider: update.provider, url, model: update.model.trim().to_string(), key };
        if let Some(parent) = self.path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        std::fs::write(&self.path, serde_json::to_string_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
        Ok(self.status())
    }

    pub fn clear(&self) -> Value { let _ = std::fs::remove_file(&self.path); self.status() }

    /// Runs one HTTP request through the Java proxy; calls `on_line` for each response line.
    async fn request(&self, method: &str, url: &str, key: &str, body: &str, cancel: &AtomicBool, mut on_line: impl FnMut(&str)) -> Result<u16, String> {
        let mut child = Command::new(&self.java).args(["-Xmx64m", "-cp"]).arg(&self.worker).arg("AssistProxy")
            .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).kill_on_drop(true)
            .spawn().map_err(|e| format!("Cannot start the assistant relay: {e}"))?;
        let mut input = format!("{method}\n{url}\nContent-Type: application/json\nAccept: text/event-stream, application/json\n");
        if !key.is_empty() { input.push_str(&format!("Authorization: Bearer {key}\n")); }
        input.push('\n');
        input.push_str(body);
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(input.as_bytes()).await.map_err(|e| e.to_string())?;
        drop(stdin);
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut status = 0;
        loop {
            if cancel.load(Ordering::Relaxed) { let _ = child.kill().await; return Err("Stopped.".into()); }
            let line = match tokio::time::timeout(Duration::from_millis(250), lines.next_line()).await {
                Err(_) => continue,
                Ok(Ok(Some(line))) => line,
                Ok(_) => break,
            };
            if let Some(code) = line.strip_prefix("S ") { status = code.trim().parse().unwrap_or(0); }
            else if let Some(text) = line.strip_prefix("L ") { on_line(text); }
            else if line == "L" { on_line(""); }
            else if let Some(message) = line.strip_prefix("E ") { let _ = child.wait().await; return Err(message.to_string()); }
            else if line == "D" { break; }
        }
        let _ = child.wait().await;
        Ok(status)
    }

    /// The model ids the endpoint lists (GET {url}/models).
    pub async fn models(&self) -> Result<Vec<String>, String> {
        let config = self.load().ok_or("Set up the assistant first.")?;
        let mut body = String::new();
        let status = self.request("GET", &format!("{}/models", config.url), &config.key, "", &AtomicBool::new(false), |l| { body.push_str(l); body.push('\n'); }).await?;
        if status >= 400 { return Err(provider_error(status, &body)); }
        let value: Value = serde_json::from_str(&body).map_err(|_| "The server's model list wasn't JSON.".to_string())?;
        let mut ids: Vec<String> = value["data"].as_array().or(value["models"].as_array()).map(|items| items.iter().filter_map(|m| m["id"].as_str().or(m["name"].as_str()).map(|s| s.trim_start_matches("models/").to_string())).collect()).unwrap_or_default();
        ids.sort();
        Ok(ids)
    }

    /// Starts a streamed chat completion and returns its id.
    pub async fn start_chat(self: &Arc<Self>, messages: Vec<ChatMessage>, max_tokens: u32) -> Result<String, String> {
        let config = self.load().ok_or("Set up the assistant first.")?;
        if messages.is_empty() || messages.len() > 40 { return Err("Send between 1 and 40 messages.".into()); }
        if messages.iter().map(|m| m.content.len()).sum::<usize>() > 160_000 { return Err("The conversation is too long. Start a new one.".into()); }
        if messages.iter().any(|m| !["system", "user", "assistant"].contains(&m.role.as_str())) { return Err("Unknown message role.".into()); }
        let permit = self.slots.clone().try_acquire_owned().map_err(|_| "The assistant is already answering. Wait or stop it.".to_string())?;
        let id = format!("chat-{}", self.next.fetch_add(1, Ordering::Relaxed));
        let job = Arc::new(Mutex::new(Job { text: String::new(), status: "running", error: String::new(), cancel: Arc::new(AtomicBool::new(false)) }));
        {
            let mut jobs = self.jobs.lock().await;
            if jobs.len() >= 16 { if let Some(oldest) = jobs.keys().min_by_key(|k| k.trim_start_matches("chat-").parse::<u64>().unwrap_or(0)).cloned() { jobs.remove(&oldest); } }
            jobs.insert(id.clone(), job.clone());
        }
        let me = self.clone();
        let body = json!({"model": config.model, "messages": messages, "stream": true, "temperature": 0.2, "max_tokens": max_tokens.clamp(64, 2048)}).to_string();
        tokio::spawn(async move {
            let cancel = job.lock().await.cancel.clone();
            let mut raw = String::new();
            let mut pending: Vec<String> = Vec::new();
            let shared = job.clone();
            let result = me.request("POST", &format!("{}/chat/completions", config.url), &config.key, &body, &cancel, |line| {
                raw.push_str(line); raw.push('\n');
                // Server-sent events: "data: {json}" chunks with choices[0].delta.content, ended by "data: [DONE]".
                if let Some(data) = line.strip_prefix("data:") {
                    let data = data.trim();
                    if data == "[DONE]" { return; }
                    if let Ok(chunk) = serde_json::from_str::<Value>(data) {
                        if let Some(text) = chunk["choices"][0]["delta"]["content"].as_str() { pending.push(text.to_string()); }
                    }
                }
                if !pending.is_empty() { if let Ok(mut job) = shared.try_lock() { for text in pending.drain(..) { job.text.push_str(&text); } } }
            }).await;
            let mut job = job.lock().await;
            for text in pending.drain(..) { job.text.push_str(&text); }
            match result {
                Ok(status) if status >= 400 => { job.status = "error"; job.error = provider_error(status, &raw); }
                Ok(_) => {
                    // A provider that ignored "stream" answers with one JSON object.
                    if job.text.is_empty() { if let Ok(value) = serde_json::from_str::<Value>(raw.trim()) { if let Some(text) = value["choices"][0]["message"]["content"].as_str() { job.text = text.to_string(); } } }
                    job.status = "done";
                    if job.text.is_empty() { job.status = "error"; job.error = "The model returned an empty answer.".into(); }
                }
                Err(message) => { job.status = if message == "Stopped." { "done" } else { "error" }; job.error = message; }
            }
            drop(permit);
        });
        Ok(id)
    }

    pub async fn chat(&self, id: &str) -> Option<Value> {
        let job = self.jobs.lock().await.get(id).cloned()?;
        let job = job.lock().await;
        Some(json!({"status": job.status, "text": job.text, "error": job.error}))
    }

    pub async fn cancel(&self, id: &str) {
        if let Some(job) = self.jobs.lock().await.get(id).cloned() { job.lock().await.cancel.store(true, Ordering::Relaxed); }
    }
}

/// A readable message from an error response, whatever shape the provider uses.
fn provider_error(status: u16, body: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(body.trim()).ok().or_else(|| body.lines().find_map(|l| serde_json::from_str(l.trim_start_matches("data:").trim()).ok()));
    let detail = parsed.as_ref().and_then(|v| v["error"]["message"].as_str().or(v["error"].as_str()).or(v["message"].as_str()).map(str::to_string))
        .unwrap_or_else(|| body.chars().take(300).collect());
    let hint = match status { 401 | 403 => " Check the API key.", 404 => " Check the address and the model name.", 429 => " The provider's rate limit was reached; wait a minute.", _ => "" };
    let detail = detail.trim();
    let stop = if detail.ends_with(['.', '!', '?']) { "" } else { "." };
    format!("The AI server answered {status}: {detail}{stop}{hint}")
}

#[cfg(test)]
mod tests {
    use super::check_url;
    #[test] fn only_local_servers_may_use_http() {
        assert!(check_url("http://127.0.0.1:11434/v1").is_ok());
        assert!(check_url("http://localhost:1234/v1").is_ok());
        assert!(check_url("https://generativelanguage.googleapis.com/v1beta/openai").is_ok());
        assert!(check_url("http://example.com/v1").is_err());
        assert!(check_url("http://localhost.evil.com/v1").is_err());
        assert!(check_url("http://user@evil.com/v1").is_err());
        assert!(check_url("ftp://localhost").is_err());
        assert!(check_url("https://").is_err());
    }
}
