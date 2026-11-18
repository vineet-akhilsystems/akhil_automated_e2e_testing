# Test Studio launcher: update code, sync packages, start portal, open browser.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$Host.UI.RawUI.WindowTitle = 'Akhil Test'
$port = if ($env:PORTAL_PORT) { $env:PORTAL_PORT } else { '4173' }
$url = "http://127.0.0.1:$port"

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "`nERROR: $m" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }

# Already running? Just open it.
try {
  Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null
  Write-Host "Test Studio already running at $url" -ForegroundColor Green
  Start-Process $url; exit 0
} catch {}

Step 'Checking tools'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js is not installed. Install Node 24+ from https://nodejs.org and run again.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'Git is not installed. Install from https://git-scm.com and run again.' }
Write-Host ("Node " + (node -v))

Step 'Getting latest code'
$dirty = git status --porcelain --untracked-files=no
if ($dirty) {
  Write-Host 'You have local changes - skipping update to avoid overwriting them.' -ForegroundColor Yellow
} else {
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { Write-Host 'Could not update (offline or diverged). Continuing with current code.' -ForegroundColor Yellow }
}

Step 'Checking packages'
$stampFile = Join-Path $root 'node_modules\.launcher-stamp'
$lock = Join-Path $root 'package-lock.json'
if (-not (Test-Path $lock)) { $lock = Join-Path $root 'package.json' }
$hash = (Get-FileHash $lock -Algorithm SHA256).Hash
$old = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { '' }
if (-not (Test-Path (Join-Path $root 'node_modules')) -or $hash -ne $old) {
  Write-Host 'Packages changed - installing...'
  if (Test-Path (Join-Path $root 'package-lock.json')) { npm ci } else { npm install }
  if ($LASTEXITCODE -ne 0) { npm install }
  if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' }
  Write-Host 'Installing Playwright browser (chromium)...'
  npx playwright install chromium
  Set-Content -Path $stampFile -Value $hash
} else {
  Write-Host 'Packages up to date.'
}

Step 'Starting Test Studio'
Write-Host "Opening $url in your browser once ready. Close this window to stop." -ForegroundColor Green
Start-Job -ArgumentList $url -ScriptBlock {
  param($u)
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $u; return } catch { Start-Sleep 1 }
  }
} | Out-Null
npm run portal
Read-Host 'Portal stopped. Press Enter to close'
