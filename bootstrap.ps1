# =====================================================================
# mini-boss-view — one-command client install for Windows (PowerShell).
#
#   irm https://raw.githubusercontent.com/Cryp01/minibossview/main/bootstrap.ps1 | iex
#
# Installs Bun if missing, clones/updates the repo to %USERPROFILE%\.mini-boss-view,
# and launches the guided installer (asks for the board URL + agent creds).
# =====================================================================
$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/Cryp01/minibossview.git"
$Dir = Join-Path $HOME ".mini-boss-view"

Write-Host "Mini Boss View - client setup"

# --- Bun -------------------------------------------------------------
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host "* Installing Bun..."
  Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression
  $env:Path = "$HOME\.bun\bin;$env:Path"
}

# --- git -------------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required. Install it from https://git-scm.com/download/win"
}

# --- clone or update -------------------------------------------------
if (Test-Path (Join-Path $Dir ".git")) {
  Write-Host "* Updating $Dir"
  git -C $Dir pull --ff-only --quiet
} else {
  Write-Host "* Cloning to $Dir"
  git clone --depth=1 --quiet $RepoUrl $Dir
}

Set-Location $Dir
Write-Host "* Installing dependencies..."
bun install | Out-Null

# --- guided installer ------------------------------------------------
Write-Host ""
bun packages/installer/bin/install.ts @args
