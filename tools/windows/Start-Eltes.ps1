<#
  Eltes AI — local static server for Windows
  ------------------------------------------
  Serves the folder that contains this script on 127.0.0.1 and opens the
  workspace. Reads no environment variables, writes nothing except an optional
  Start-menu shortcut, and makes no outbound connection.

  Usage:
    powershell -ExecutionPolicy Bypass -File .\Start-Eltes.ps1
    powershell -ExecutionPolicy Bypass -File .\Start-Eltes.ps1 -Port 8080
    powershell -ExecutionPolicy Bypass -File .\Start-Eltes.ps1 -Shortcut
    powershell -ExecutionPolicy Bypass -File .\Start-Eltes.ps1 -NoBrowser
#>
[CmdletBinding()]
param(
  [int]$Port = 4173,
  [switch]$Shortcut,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Step([string]$text) { Write-Host "  $text" -ForegroundColor Cyan }
function Write-Ok([string]$text)   { Write-Host "  $text" -ForegroundColor Green }
function Write-Warn2([string]$text){ Write-Host "  $text" -ForegroundColor Yellow }

if (-not (Test-Path (Join-Path $root 'index.html'))) {
  Write-Warn2 "index.html was not found next to this script."
  Write-Warn2 "Unzip the whole eltes-windows folder and run the launcher from inside it."
  exit 1
}

function Test-Port([int]$p) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect('127.0.0.1', $p, $null, $null)
    $ready = $async.AsyncWaitHandle.WaitOne(220)
    if ($ready -and $client.Connected) { $client.Close(); return $true }
    $client.Close()
    return $false
  } catch { return $false }
}

function Find-Free-Port([int]$start) {
  for ($p = $start; $p -lt ($start + 25); $p++) {
    if (-not (Test-Port $p)) { return $p }
  }
  return $start
}

if (Test-Port $Port) {
  $chosen = Find-Free-Port ($Port + 1)
  Write-Warn2 "Port $Port is already in use; using $chosen instead."
  $Port = $chosen
}

# ---------------------------------------------------------------- runtimes --
$python = $null
foreach ($candidate in @('python', 'py')) {
  $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
  if ($cmd) {
    try {
      $null = & $cmd.Source --version 2>&1
      if ($LASTEXITCODE -eq 0) { $python = $cmd.Source; break }
    } catch { }
  }
}

$node = (Get-Command node -ErrorAction SilentlyContinue)
$serve = $null
if ($python) { $serve = 'python' }
elseif ($node) {
  $serve = 'node'
}

if (-not $serve) {
  Write-Warn2 "Eltes needs Python 3 or Node.js 18+ to serve its files."
  Write-Warn2 "Install one of them, then run eltes.bat again."
  Write-Warn2 "Python: https://www.python.org/downloads/windows/"
  exit 1
}

$url = "http://127.0.0.1:$Port/app.html"
$homeUrl = "http://127.0.0.1:$Port/index.html"

# --------------------------------------------------------------- shortcut ---
if ($Shortcut) {
  try {
    $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $lnkPath = Join-Path $startMenu 'Eltes AI.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = Join-Path $root 'eltes.bat'
    $lnk.WorkingDirectory = $root
    $lnk.Description = 'Eltes AI - local-first agent workspace'
    $icon = Join-Path $root 'assets\img\favicon.ico'
    if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
    $lnk.Save()
    Write-Ok "Start-menu shortcut created: Eltes AI"
  } catch {
    Write-Warn2 "Could not create the shortcut: $($_.Exception.Message)"
  }
}

# ------------------------------------------------------------------- serve --
Write-Step "Serving $root"
Write-Step "Workspace: $url"
Write-Step "Stop the server with Ctrl+C or by closing this window."
Write-Host ""

if (-not $NoBrowser) {
  Start-Process $url | Out-Null
}

try {
  if ($serve -eq 'python') {
    & $python -m http.server $Port --bind 127.0.0.1
  } else {
    # tiny, dependency-free static server for Node 18+
    $js = @'
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8', '.md':'text/markdown; charset=utf-8', '.zip':'application/zip', '.webmanifest':'application/manifest+json' };
const port = Number(process.argv[2] || 4173);
http.createServer((req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, raw === '/' ? 'index.html' : raw);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, stat) => {
    if (!err && stat.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  });
}).listen(port, '127.0.0.1');
'@
    $tmp = Join-Path $env:TEMP 'eltes-server.cjs'
    Set-Content -Path $tmp -Value $js -Encoding UTF8
    & $node.Source $tmp $Port
  }
} finally {
  Write-Host ""
  Write-Ok "Eltes server stopped."
}
