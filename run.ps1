<#
  Builds and starts the CodeTrace Python Visualizer.

    .\run.cmd              build the React frontend + Rust server, then start on http://localhost:8000
    .\run.cmd -SkipBuild   start the last build without rebuilding

  Python is only used by tracer.py (pg_logger). The server uses .venv\Scripts\python.exe if it exists.
#>
param([switch]$SkipBuild)

Set-Location $PSScriptRoot

function Add-ToPath([string]$dir) {
    if ($dir -and (Test-Path $dir) -and -not (($env:PATH -split ';') -contains $dir)) { $env:PATH = "$dir;$env:PATH" }
}
function Fail([string]$msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

# Toolchains installed per-user (no admin): Rust via rustup, Node as a portable zip in ~\tools.
Add-ToPath "$env:USERPROFILE\.cargo\bin"
$node = Get-ChildItem "$env:USERPROFILE\tools" -Directory -Filter "node-v*-win-x64" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
if ($node) { Add-ToPath $node.FullName }

if (-not $SkipBuild) {
    foreach ($tool in "cargo", "npm") {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool wasn't found. See README.md > Setup." }
    }

    # Rust's windows-gnu toolchain needs a standalone dlltool; use the one from llvm-mingw.
    $rustHost = ((rustc -vV) | Where-Object { $_ -like 'host:*' }) -replace '^host:\s*', ''
    if ($rustHost -like '*windows-gnu') {
        $mingw = Get-ChildItem "$env:USERPROFILE\tools" -Directory -Filter "llvm-mingw-*" -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | Select-Object -First 1
        $dlltool = if ($mingw) { Join-Path $mingw.FullName "bin\x86_64-w64-mingw32-dlltool.exe" }
        if (-not $dlltool -or -not (Test-Path $dlltool)) { Fail "llvm-mingw not found in $env:USERPROFILE\tools. See README.md > Setup." }
        $env:CARGO_ENCODED_RUSTFLAGS = "-Cdlltool=$dlltool"
    }

    Write-Host "Building frontend (React + TypeScript)..." -ForegroundColor Cyan
    Push-Location frontend
    if (-not (Test-Path node_modules)) {
        npm install --no-audit --no-fund
        if ($LASTEXITCODE) { Pop-Location; Fail "npm install failed." }
    }
    npm run build --silent
    if ($LASTEXITCODE) { Pop-Location; Fail "Frontend build failed (see errors above)." }
    Pop-Location

    Write-Host "Building server (Rust)..." -ForegroundColor Cyan
    cargo build --release --quiet --manifest-path server\Cargo.toml
    if ($LASTEXITCODE) { Fail "Server build failed (see errors above)." }
}

$exe = Join-Path $PSScriptRoot "server\target\release\kiro-server.exe"
if (-not (Test-Path $exe)) { Fail "Server isn't built yet. Run .\run.cmd without -SkipBuild." }
& $exe
