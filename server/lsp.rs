//! Bridge to an Eclipse JDT Language Server for editor features (completion, hovers, rename, quick fixes,
//! as-you-type diagnostics). The browser speaks LSP JSON-RPC; this module only frames messages, keeps the
//! project's files on disk for the server to index, and relays server messages through long polling.
//! One language server serves the most recently synced project.

use serde_json::{json, Value};
use std::{path::{Path, PathBuf}, sync::Arc, time::Duration};
use tokio::{io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader}, process::{Child, ChildStdin, Command}, sync::{Mutex, Notify}};

use crate::SourceFile;

/// Where the server and a Java 21+ runtime for it live, discovered by scripts/env.mjs.
#[derive(Clone)]
pub struct Config { pub home: PathBuf, pub java: PathBuf, pub runtime_home: PathBuf }

const MAX_BUFFERED: usize = 4000;
const MAX_MESSAGE: usize = 8 * 1024 * 1024;

struct Inner {
    session: u64,
    state: &'static str,
    reason: String,
    /// Sequence number of `messages[0]`.
    base: usize,
    messages: Vec<Value>,
    child: Option<Child>,
    /// The server is initialized once; a reloaded page reuses the cached result instead of initializing again.
    init_id: Option<Value>,
    init_result: Option<Value>,
    initialized_sent: bool,
    /// Documents opened by clients, closed when a new page connects so it can open them afresh.
    open: std::collections::HashSet<String>,
}

pub struct Lsp {
    config: Option<Config>,
    dir: PathBuf,
    inner: Mutex<Inner>,
    stdin: Mutex<Option<ChildStdin>>,
    notify: Notify,
}

impl Lsp {
    pub fn new(root: &Path) -> Arc<Self> {
        let config = std::env::var_os("TRACELAB_JDTLS_HOME").zip(std::env::var_os("TRACELAB_JDTLS_JAVA")).map(|(home, java)| Config {
            home: PathBuf::from(home), java: PathBuf::from(java),
            runtime_home: std::env::var_os("JAVA_HOME").map(PathBuf::from).unwrap_or_default(),
        });
        let (state, reason) = if config.is_some() { ("off", String::new()) } else { ("unavailable", "No Java language server was found. Install the VS Code Java extension (redhat.java), run npm run setup:jdtls, or set TRACELAB_JDTLS_HOME.".to_string()) };
        Arc::new(Self { config, dir: root.join(".local/lsp"), inner: Mutex::new(Inner { session: 0, state, reason, base: 0, messages: Vec::new(), child: None, init_id: None, init_result: None, initialized_sent: false, open: Default::default() }), stdin: Mutex::new(None), notify: Notify::new() })
    }

    pub fn project_dir(&self) -> PathBuf { self.dir.join("project") }

    pub async fn status(&self) -> Value {
        let inner = self.inner.lock().await;
        json!({"state": inner.state, "reason": inner.reason, "session": inner.session})
    }

    /// Starts the server if it isn't running and returns what the client needs to initialize it.
    pub async fn start(self: &Arc<Self>) -> Result<Value, String> {
        let config = self.config.clone().ok_or_else(|| self.reason_blocking())?;
        let mut inner = self.inner.lock().await;
        if inner.state != "starting" && inner.state != "running" {
            for sub in ["project", "data"] { tokio::fs::create_dir_all(self.dir.join(sub)).await.map_err(|e| e.to_string())?; }
            let os = if cfg!(windows) { "config_win" } else if cfg!(target_os = "macos") { if cfg!(target_arch = "aarch64") { "config_mac_arm" } else { "config_mac" } } else if cfg!(target_arch = "aarch64") { "config_linux_arm" } else { "config_linux" };
            // The OSGi configuration folder must be writable, so use a copy.
            let config_dir = self.dir.join("config");
            if !config_dir.exists() { copy_dir(&config.home.join(os), &config_dir).map_err(|e| format!("Cannot prepare the language server configuration: {e}"))?; }
            tokio::fs::write(self.dir.join("compiler.prefs"), COMPILER_PREFS).await.map_err(|e| e.to_string())?;
            let launcher = std::fs::read_dir(config.home.join("plugins")).map_err(|e| e.to_string())?
                .filter_map(|e| e.ok()).map(|e| e.path())
                .find(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("org.eclipse.equinox.launcher_") && n.ends_with(".jar")))
                .ok_or("The language server folder has no Equinox launcher.")?;
            let mut command = Command::new(&config.java);
            command.args(["-Declipse.application=org.eclipse.jdt.ls.core.id1", "-Dosgi.bundles.defaultStartLevel=4", "-Declipse.product=org.eclipse.jdt.ls.core.product",
                    "-Dlog.level=WARNING", "-Xmx1G", "-XX:+UseSerialGC", "--add-modules=ALL-SYSTEM", "--add-opens", "java.base/java.util=ALL-UNNAMED", "--add-opens", "java.base/java.lang=ALL-UNNAMED", "-jar"])
                .arg(&launcher).arg("-configuration").arg(&config_dir).arg("-data").arg(self.dir.join("data"))
                .current_dir(&self.dir).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
            for key in ["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "CLASSPATH"] { command.env_remove(key); }
            let mut child = command.spawn().map_err(|e| format!("Cannot start the Java language server: {e}"))?;
            let stdout = child.stdout.take().unwrap();
            let stderr = child.stderr.take().unwrap();
            *self.stdin.lock().await = child.stdin.take();
            inner.session += 1;
            inner.state = "running";
            inner.reason.clear();
            inner.base = 0;
            inner.messages.clear();
            inner.child = Some(child);
            inner.init_id = None;
            inner.init_result = None;
            inner.initialized_sent = false;
            inner.open.clear();
            let session = inner.session;
            let me = self.clone();
            tokio::spawn(async move {
                // Drain stderr for the server's whole life (a full pipe would block it) and keep the end for errors.
                let tail = tokio::spawn(async move {
                    let mut stderr = stderr;
                    let mut tail: Vec<u8> = Vec::new();
                    let mut chunk = [0u8; 4096];
                    while let Ok(n) = stderr.read(&mut chunk).await {
                        if n == 0 { break; }
                        tail.extend_from_slice(&chunk[..n]);
                        if tail.len() > 3000 { tail.drain(..tail.len() - 1500); }
                    }
                    String::from_utf8_lossy(&tail).trim().to_string()
                });
                let result = me.read_messages(stdout, session).await;
                let stderr = tail.await.unwrap_or_default();
                let mut inner = me.inner.lock().await;
                if inner.session == session {
                    inner.state = "stopped";
                    inner.reason = match result { Err(e) => format!("The Java language server stopped: {e}. {stderr}"), Ok(()) => format!("The Java language server exited. {stderr}") }.trim().to_string();
                    inner.child = None;
                }
                drop(inner);
                me.notify.notify_waiters();
            });
        }
        else if !inner.open.is_empty() {
            // A new page took over: close the previous page's documents.
            let closes: Vec<Value> = inner.open.drain().map(|uri| json!({"jsonrpc": "2.0", "method": "textDocument/didClose", "params": {"textDocument": {"uri": uri}}})).collect();
            let session = inner.session;
            drop(inner);
            self.send(session, &closes).await?;
            inner = self.inner.lock().await;
        }
        let runtime = &config.runtime_home;
        Ok(json!({
            "session": inner.session, "state": inner.state, "next": inner.base + inner.messages.len(), "initialized": inner.init_result.is_some(),
            "rootPath": self.project_dir().to_string_lossy(), "settingsPath": self.dir.join("compiler.prefs").to_string_lossy(),
            "runtimePath": runtime.to_string_lossy(), "runtimeName": format!("JavaSE-{}", java_major(runtime).unwrap_or(21)),
        }))
    }

    fn reason_blocking(&self) -> String { "No Java language server is configured.".into() }

    async fn read_messages(&self, stdout: tokio::process::ChildStdout, session: u64) -> Result<(), String> {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut length = None;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).await.map_err(|e| e.to_string())? == 0 { return Ok(()); }
                let line = line.trim_end();
                if line.is_empty() { break; }
                if let Some(value) = line.strip_prefix("Content-Length:") { length = value.trim().parse::<usize>().ok(); }
            }
            let length = length.ok_or("a message had no Content-Length")?;
            if length > MAX_MESSAGE { return Err("a message was too large".into()); }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).await.map_err(|e| e.to_string())?;
            let Ok(message) = serde_json::from_slice::<Value>(&body) else { continue };
            let mut inner = self.inner.lock().await;
            if inner.session != session { return Ok(()); }
            if inner.init_result.is_none() && inner.init_id.is_some() && message.get("id") == inner.init_id.as_ref() && message.get("result").is_some() {
                inner.init_result = Some(message["result"].clone());
            }
            inner.messages.push(message);
            if inner.messages.len() > MAX_BUFFERED {
                let drop = inner.messages.len() - MAX_BUFFERED;
                inner.messages.drain(..drop);
                inner.base += drop;
            }
            drop(inner);
            self.notify.notify_waiters();
        }
    }

    /// Writes client messages to the server, framed with Content-Length.
    pub async fn send(&self, session: u64, messages: &[Value]) -> Result<(), String> {
        let mut forward: Vec<Value> = Vec::new();
        {
            let mut inner = self.inner.lock().await;
            if inner.session != session { return Err("The language server restarted. Reconnect.".into()); }
            for message in messages {
                if message.get("jsonrpc") != Some(&json!("2.0")) { return Err("Messages must be JSON-RPC 2.0.".into()); }
                match message["method"].as_str() {
                    // The server is shared by page loads, so it is initialized once and never shut down by a page.
                    Some("initialize") => match inner.init_result.clone() {
                        Some(result) => { let reply = json!({"jsonrpc": "2.0", "id": message["id"], "result": result}); inner.messages.push(reply); self.notify.notify_waiters(); continue; }
                        None => {
                            inner.init_id = Some(message["id"].clone());
                            // JDT LS exits when this process dies, so a killed runner never leaves it holding the workspace.
                            let mut message = message.clone();
                            message["params"]["processId"] = json!(std::process::id());
                            forward.push(message);
                            continue;
                        }
                    },
                    Some("initialized") => { if inner.initialized_sent { continue; } inner.initialized_sent = true; }
                    Some("shutdown") | Some("exit") => continue,
                    Some("textDocument/didOpen") => { if let Some(uri) = message["params"]["textDocument"]["uri"].as_str() { inner.open.insert(uri.to_string()); } }
                    Some("textDocument/didClose") => { if let Some(uri) = message["params"]["textDocument"]["uri"].as_str() { inner.open.remove(uri); } }
                    _ => {}
                }
                forward.push(message.clone());
            }
        }
        let mut stdin = self.stdin.lock().await;
        let Some(stdin) = stdin.as_mut() else { return Err("The language server isn't running.".into()) };
        for message in &forward {
            let body = serde_json::to_vec(message).map_err(|e| e.to_string())?;
            stdin.write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes()).await.map_err(|e| e.to_string())?;
            stdin.write_all(&body).await.map_err(|e| e.to_string())?;
        }
        stdin.flush().await.map_err(|e| e.to_string())
    }

    /// Server messages with sequence numbers from `since`, waiting up to `wait` for new ones.
    pub async fn receive(&self, session: u64, since: usize, wait: Duration) -> Value {
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            let notified = self.notify.notified();
            {
                let inner = self.inner.lock().await;
                let end = inner.base + inner.messages.len();
                if inner.session != session || since < end || inner.state != "running" || tokio::time::Instant::now() >= deadline {
                    let from = since.max(inner.base).min(end);
                    return json!({"session": inner.session, "state": inner.state, "reason": inner.reason, "next": end, "messages": &inner.messages[from - inner.base..]});
                }
            }
            tokio::select! { _ = notified => {}, _ = tokio::time::sleep_until(deadline) => {} }
        }
    }

    /// Mirrors the project's files into the server's workspace folder and removes other Java files there.
    pub async fn write_files(&self, files: &[SourceFile]) -> Result<Value, String> {
        let dir = self.project_dir();
        tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
        let keep: std::collections::HashSet<PathBuf> = files.iter().map(|f| dir.join(&f.name)).collect();
        let mut removed = Vec::new();
        for path in java_files(&dir) {
            if !keep.contains(&path) {
                let _ = tokio::fs::remove_file(&path).await;
                removed.push(path.strip_prefix(&dir).unwrap_or(&path).to_string_lossy().replace('\\', "/"));
            }
        }
        remove_empty_dirs(&dir);
        let mut created = Vec::new();
        for file in files {
            let path = dir.join(&file.name);
            if let Some(parent) = path.parent() { tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?; }
            let existed = path.exists();
            if !existed || tokio::fs::read_to_string(&path).await.ok().as_deref() != Some(file.content.as_str()) { tokio::fs::write(&path, &file.content).await.map_err(|e| e.to_string())?; }
            if !existed { created.push(file.name.clone()); }
        }
        Ok(json!({"created": created, "removed": removed}))
    }

    /// Stops the server. A client reconnecting afterwards starts a new one.
    pub async fn stop(&self) {
        let child = {
            let mut inner = self.inner.lock().await;
            if inner.state == "running" { inner.state = "stopped"; inner.reason = "The Java language server was stopped.".into(); }
            inner.session += 1;
            inner.child.take()
        };
        *self.stdin.lock().await = None;
        if let Some(mut child) = child { crate::kill_tree(&mut child).await; }
        self.notify.notify_waiters();
    }
}

fn java_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() { stack.push(path); } else if path.extension().is_some_and(|e| e == "java") { out.push(path); }
        }
    }
    out
}

fn remove_empty_dirs(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            remove_empty_dirs(&path);
            let _ = std::fs::remove_dir(&path);
        }
    }
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() { copy_dir(&entry.path(), &target)?; } else { std::fs::copy(entry.path(), target)?; }
    }
    Ok(())
}

/// Major version from a JDK's `release` file (JAVA_VERSION="25.0.4.1").
fn java_major(home: &Path) -> Option<u32> {
    let text = std::fs::read_to_string(home.join("release")).ok()?;
    let line = text.lines().find(|l| l.starts_with("JAVA_VERSION="))?;
    line.trim_start_matches("JAVA_VERSION=").trim_matches('"').split('.').next()?.parse().ok()
}

/// Compiler settings matching javac --release 21, with warnings for common beginner mistakes.
const COMPILER_PREFS: &str = "org.eclipse.jdt.core.compiler.compliance=21
org.eclipse.jdt.core.compiler.source=21
org.eclipse.jdt.core.compiler.codegen.targetPlatform=21
org.eclipse.jdt.core.compiler.release=enabled
org.eclipse.jdt.core.compiler.problem.unusedLocal=warning
org.eclipse.jdt.core.compiler.problem.unusedPrivateMember=warning
org.eclipse.jdt.core.compiler.problem.emptyStatement=warning
org.eclipse.jdt.core.compiler.problem.noEffectAssignment=warning
org.eclipse.jdt.core.compiler.problem.comparingIdentical=warning
org.eclipse.jdt.core.compiler.problem.nullReference=warning
org.eclipse.jdt.core.compiler.problem.potentialNullReference=warning
org.eclipse.jdt.core.compiler.problem.fallthroughCase=warning
org.eclipse.jdt.core.compiler.problem.deadCode=warning
org.eclipse.jdt.core.compiler.problem.unlikelyEqualsArgumentType=warning
org.eclipse.jdt.core.compiler.problem.unlikelyCollectionMethodArgumentType=warning
org.eclipse.jdt.core.compiler.problem.missingDefaultCase=ignore
org.eclipse.jdt.core.compiler.problem.unusedImport=warning
org.eclipse.jdt.core.compiler.problem.uninitializedLocalVariable=error
org.eclipse.jdt.core.compiler.problem.possibleAccidentalBooleanAssignment=warning
org.eclipse.jdt.core.compiler.problem.indirectStaticAccess=ignore
org.eclipse.jdt.core.compiler.problem.unusedParameter=ignore
org.eclipse.jdt.core.compiler.problem.missingSerialVersion=ignore
org.eclipse.jdt.core.compiler.problem.rawTypeReference=warning
";
