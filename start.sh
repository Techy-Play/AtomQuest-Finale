#!/usr/bin/env bash
# ConnectDesk — Production Starter (Linux / macOS)
# Usage:
#   ./start.sh           — start production (must have run npm run build first)
#   ./start.sh --build   — build then start
#   ./start.sh --setup   — run DB setup then start
#   ./start.sh --build --setup   — full fresh install

set -e

BUILD=false
SETUP=false

for arg in "$@"; do
  case $arg in
    --build) BUILD=true ;;
    --setup) SETUP=true ;;
  esac
done

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║       ConnectDesk — Production Starter       ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

# Validate .env
if [ ! -f ".env" ]; then
  echo "  ❌  .env file not found!"
  echo "  Copy .env.example to .env and fill in your values."
  exit 1
fi

# DB setup
if [ "$SETUP" = true ]; then
  echo "  🗄️  Setting up database..."
  npm run setup
  echo "  ✅  Database ready."
fi

# Build
if [ "$BUILD" = true ] || [ ! -d ".next/standalone" ]; then
  echo "  🔨  Building production bundle..."
  npm run build
  echo "  ✅  Build complete."
fi

# Copy static assets into standalone
echo "  📁  Copying static assets..."
if [ -d ".next/standalone" ]; then
  [ -d "public" ] && cp -r public .next/standalone/public 2>/dev/null || true
  if [ -d ".next/static" ]; then
    mkdir -p .next/standalone/.next/static
    cp -r .next/static/. .next/standalone/.next/static/ 2>/dev/null || true
  fi
fi

echo ""
echo "  🚀  Starting ConnectDesk..."
echo "  📡  Next.js  → http://localhost:3000"
echo "  🎥  SFU      → http://localhost:3001"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

npm run start:prod
