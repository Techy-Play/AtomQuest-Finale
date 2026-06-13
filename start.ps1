# ConnectDesk — Production Starter (Windows)
# Run this script to start ConnectDesk in production mode.
# Requirements: Node.js 18+, npm, .env configured, npm run build already done.

param(
  [switch]$Build,   # Pass -Build to rebuild before starting
  [switch]$Setup    # Pass -Setup to run db:push + seed before starting
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║       ConnectDesk — Production Starter       ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Validate .env
if (-not (Test-Path ".env")) {
  Write-Host "  ❌  .env file not found!" -ForegroundColor Red
  Write-Host "  Copy .env.example to .env and fill in your values." -ForegroundColor Yellow
  exit 1
}

# Run DB setup if requested
if ($Setup) {
  Write-Host "  🗄️  Setting up database..." -ForegroundColor Yellow
  npm run setup
  Write-Host "  ✅  Database ready." -ForegroundColor Green
}

# Build if requested or if .next/standalone doesn't exist
if ($Build -or -not (Test-Path ".next/standalone")) {
  Write-Host "  🔨  Building production bundle..." -ForegroundColor Yellow
  npm run build
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  ❌  Build failed. Fix errors above and retry." -ForegroundColor Red
    exit 1
  }
  Write-Host "  ✅  Build complete." -ForegroundColor Green
}

# Copy static assets into standalone (required by Next.js standalone mode)
Write-Host "  📁  Copying static assets..." -ForegroundColor Yellow
if (Test-Path ".next/standalone") {
  # Copy public folder
  if (Test-Path "public") {
    Copy-Item -Recurse -Force "public" ".next/standalone/public" -ErrorAction SilentlyContinue
  }
  # Copy static assets
  if (Test-Path ".next/static") {
    New-Item -ItemType Directory -Force ".next/standalone/.next/static" | Out-Null
    Copy-Item -Recurse -Force ".next/static/*" ".next/standalone/.next/static/" -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "  🚀  Starting ConnectDesk..." -ForegroundColor Green
Write-Host "  📡  Next.js  → http://localhost:3000" -ForegroundColor Cyan
Write-Host "  🎥  SFU      → http://localhost:3001" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

# Start both servers
npm run start:prod
