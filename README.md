# ConnectDesk — Real-Time Video Support Platform

> A full-stack, production-ready customer support platform with live chat, voice calls, and HD video sessions — built for the **AtomQuest Hackathon 2026**.

![Next.js](https://img.shields.io/badge/Next.js-16.2-black?style=flat-square&logo=next.js)
![mediasoup](https://img.shields.io/badge/mediasoup-3.20-ff6b35?style=flat-square)
![Prisma](https://img.shields.io/badge/Prisma-7.8-2D3748?style=flat-square&logo=prisma)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-010101?style=flat-square&logo=socket.io)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Quick Start (Development)](#-quick-start-development)
- [Production Build & Deployment](#-production-build--deployment)
- [Environment Variables](#-environment-variables)
- [Mobile / LAN Access](#-mobile--lan-access)
- [Demo Accounts](#-demo-accounts)
- [Usage Guide](#-usage-guide)
- [Project Structure](#-project-structure)
- [npm Scripts Reference](#-npm-scripts-reference)

---

## 🚀 Overview

ConnectDesk mirrors real enterprise support systems like Intercom and Zendesk. An agent creates a support session and invites a customer via a unique link or email. The session smoothly escalates from **chat → voice → HD video** as needed.

All media is routed through a **mediasoup SFU** (Selective Forwarding Unit) — a server-side WebRTC architecture that works reliably behind NAT, firewalls, and mobile networks without peer-to-peer connectivity requirements.

---

## ✨ Features

### 👤 Agent
- Dashboard to **create, manage, and monitor** support sessions
- Invite customers via **email** (with invite link) or **copy shareable link**
- Escalate sessions: **Chat → Voice → Video** at any time
- **Mute / unmute** audio and **toggle camera** independently
- **Manual recording** — start/stop at any time; recordings stored to Cloudinary with download links
- **Session History** deep-links: Chat, Shared Files, Recordings, and Event Log tabs per session

### 👥 Customer
- Join via invite link — **no account required** (guest join with name)
- Real-time chat with **file & image sharing**
- **Accept or decline** incoming voice and video requests from agent
- **Mute audio** or **turn off camera** independently at any time
- **Camera switch** (front ↔ back) on mobile devices
- Works on **Android and iOS** mobile browsers

### 🎥 Media Engine
- **mediasoup v3 SFU** — server-routed WebRTC (no P2P; works behind NAT/firewalls)
- **Auto-retry on startup** — connects up to 8 times with 3s delay; no manual refresh needed while SFU initialises
- **Full echo cancellation** — `echoCancellation`, `noiseSuppression`, `autoGainControl` + Chrome/Android extended `goog*` constraints
- **Stale consumer cleanup** — previous audio/video consumers closed before new ones are created, preventing audio doubling
- **Consumer track muting** — when a peer mutes, the actual WebRTC track is disabled (not just a UI badge)
- `object-contain` video layout — portrait mobile cameras displayed with correct aspect ratio, no cropping

### 📜 Session History
- Full chat history retrievable after the call ends
- Shared files browsable with image preview
- Session recordings stored to Cloudinary, playable and downloadable from the history page
- Event log showing join/leave/escalation events with timestamps

---

## 🏗️ Architecture

```
Browser (Next.js 16 App Router)
    │
    ├─── REST API  /api/*  (Next.js Route Handlers)
    │       ├── /api/auth/login|logout|register|me
    │       ├── /api/sessions              — CRUD sessions
    │       ├── /api/sessions/invite       — create session + send email invite
    │       ├── /api/sessions/join         — guest join via invite token
    │       ├── /api/sessions/[id]         — session details + chat history
    │       ├── /api/sessions/[id]/messages — persist chat messages
    │       ├── /api/recordings/[id]       — save/list recording metadata
    │       ├── /api/upload                — Cloudinary file & recording upload
    │       └── /api/users/customers       — list registered customers
    │
    └─── Socket.IO + mediasoup SFU  (server.ts  →  port 3001)
            │
            ├── join-room          — load mediasoup Device + get existing peers
            ├── create-transport   — WebRTC send/recv transport negotiation
            ├── produce            — publish local audio or video track
            ├── consume            — subscribe to a remote peer's track
            ├── resume-consumer    — unpause consumer after ICE connection
            ├── media-state-change — broadcast mute/unmute events
            └── session-ended      — notify all peers when agent ends session
```

---

## 🛠 Tech Stack

| Layer | Technology | Version |
|---|---|---|
| **Framework** | Next.js (App Router) | 16.2.9 |
| **UI** | React + Tailwind CSS v4 + shadcn/ui | 19.x |
| **WebRTC SFU** | mediasoup | 3.20.5 |
| **Realtime** | Socket.IO | 4.8.3 |
| **Database ORM** | Prisma | 7.8 |
| **Database** | PostgreSQL | any |
| **Auth** | JWT (HttpOnly cookies) | — |
| **File Storage** | Cloudinary | 2.x |
| **Email** | Nodemailer (SMTP) | 8.x |
| **Language** | TypeScript | 5.x |

---

## 📦 Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js ≥ 18** | [nodejs.org](https://nodejs.org) |
| **npm ≥ 9** | Included with Node.js |
| **PostgreSQL** | Local or hosted (Neon, Supabase, Railway) |
| **Cloudinary account** | Free tier works — [cloudinary.com](https://cloudinary.com) |
| **SMTP credentials** | Gmail App Password works |
| **Windows Build Tools** | Required for mediasoup native compilation on Windows |

### Windows Build Tools (first time only)

mediasoup compiles native C++ binaries. Install the build tools once:

```powershell
# Option A — via npm (run PowerShell as Administrator)
npm install --global windows-build-tools

# Option B — manual install
# Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/
# Select: "Desktop development with C++"
```

---

## ⚡ Quick Start (Development)

```bash
# 1. Clone
git clone https://github.com/Techy-Play/AtomQuest-Finale.git
cd AtomQuest-Finale/video-support-platform

# 2. Install dependencies  (mediasoup will compile native binaries — takes ~2 min first time)
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your database, Cloudinary, SMTP, and LAN IP values

# 4. Set up database
npm run db:push     # creates tables from schema
npm run seed        # creates demo agent/customer/admin accounts

# 5. Open firewall for mobile testing (Windows — run as Administrator)
.\open-firewall-ports.ps1

# 6. Start development server
npm run dev:all
```

Open **http://localhost:3000** — the app is live.

> **Note:** The SFU (port 3001) takes ~5 seconds to start after Next.js. The session page shows **"Connecting…"** and auto-retries up to 8 times — no manual refresh needed.

---

## 🏭 Production Build & Deployment

### Build

```bash
npm run build
```

This runs two steps in sequence:
1. `prisma generate && next build` — generates Prisma client, type-checks, and outputs `.next/standalone/`
2. `tsc --project tsconfig.server.json` — compiles `server.ts` → `dist/server.js`

### Copy Static Assets (required after every build)

```bash
# Windows
Copy-Item -Recurse -Force public .next/standalone/public
Copy-Item -Recurse -Force .next/static .next/standalone/.next/static

# Linux / macOS
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
```

### Start Production

```bash
# Both Next.js app + SFU server together
npm run start:prod
```

### One-click Launchers

```powershell
# Windows — first run (builds + DB setup + starts)
.\start.ps1 -Build -Setup

# Windows — subsequent runs (just starts)
.\start.ps1
```

```bash
# Linux / macOS — first run
chmod +x start.sh
./start.sh --build --setup

# Linux / macOS — subsequent runs
./start.sh
```

### What `npm run build` produces

```
.next/
└── standalone/          ← Self-contained Next.js app (runs with just Node.js)
    ├── server.js         ← Next.js production server
    ├── .next/static/     ← CSS, JS, fonts (must be copied here manually)
    └── public/           ← Static assets (must be copied here manually)

dist/
└── server.js            ← Compiled mediasoup SFU server (CommonJS)
```

---

## 🔑 Environment Variables

Create a `.env` file (copy from `.env.example`):

```env
# ── Database ─────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://user:password@localhost:5432/connectdesk"

# ── Authentication ────────────────────────────────────────────────────────
JWT_SECRET="your-secret-key-min-32-chars"

# ── Cloudinary (file uploads + session recordings) ───────────────────────
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"

# ── Email / SMTP ──────────────────────────────────────────────────────────
# Gmail: Settings → Security → 2-Step Verification → App passwords
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your@gmail.com"
SMTP_PASS="your_16_char_app_password"

# ── mediasoup SFU — YOUR MACHINE'S LAN IP ────────────────────────────────
# Find it:  Windows → ipconfig   |   Linux → ip addr   |   macOS → ifconfig
# Required for mobile devices to connect over WiFi
MEDIASOUP_ANNOUNCED_IP="192.168.1.X"

# ── Optional overrides ────────────────────────────────────────────────────
# SOCKET_PORT=3001
# NEXT_PUBLIC_APP_URL="https://your-domain.com"
# NEXT_PUBLIC_SOCKET_URL="http://192.168.1.X:3001"
```

---

## 📱 Mobile / LAN Access

To test with a real phone on the same WiFi network:

**Step 1 — Find your LAN IP**
```powershell
ipconfig | findstr "IPv4"
# Output example:  IPv4 Address . . . : 192.168.1.42
```

**Step 2 — Set it in `.env`**
```env
MEDIASOUP_ANNOUNCED_IP=192.168.1.42
```

**Step 3 — Open firewall ports (run as Administrator)**
```powershell
.\open-firewall-ports.ps1
```
This opens TCP 3001 (Socket.IO) and UDP 10000–10100 (WebRTC media).

**Step 4 — Access from mobile**
```
http://192.168.1.42:3000
```

---

## 🔐 Demo Accounts

After running `npm run seed`:

| Role | Email | Password |
|---|---|---|
| **Agent** | `agent@atomquest.com` | `agent123` |
| **Customer** | `customer@example.com` | `customer123` |
| **Admin** | `admin@atomquest.com` | `admin123` |

---

## 🧭 Usage Guide

### As an Agent

1. Go to `http://localhost:3000` → **Login** as agent
2. Click **New Session** → enter a title and (optionally) select an existing customer
3. Share the invite: **copy the link** or enter a customer email to send it
4. Click **Join** on the session card to enter the live session
5. **Chat** in the right panel — supports text, images, and file attachments
6. Escalate the session:
   - **Mic icon** → Start Voice Support (agent's mic goes live)
   - **Camera icon** → Request Customer Camera (customer gets a prompt to accept/decline)
7. During a call:
   - **Mute button** — toggle your microphone
   - **Camera button** — toggle your video
   - **Record button** — start/stop session recording (saved to Cloudinary)
8. Click **End Session** to close the call for all participants
9. Go to **History** → view full chat, files, recordings, and event log

### As a Customer

1. Open the invite link (e.g. `http://192.168.1.42:3000/join/TOKEN`)
2. Enter your name → **Join Session**
3. Chat with the agent in real time
4. When a voice/video request arrives, a prompt appears — **Accept** or **Decline**
5. During a call:
   - **Mute button** — toggle microphone
   - **Camera button** — toggle video
   - **Switch Camera (🔄)** — flip between front and back camera (mobile only)

---

## 📁 Project Structure

```
video-support-platform/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Login / Register / Guest Join
│   │   ├── agent/                # Agent dashboard (session list)
│   │   ├── customer/             # Customer dashboard
│   │   ├── session/[id]/         # Live session (chat + video)
│   │   │   └── page.tsx          # Main session UI — media controls, recording, chat
│   │   ├── history/[id]/         # Session history (Chat / Files / Recordings / Info tabs)
│   │   ├── join/[token]/         # Customer invite join flow
│   │   └── api/                  # REST API route handlers
│   ├── hooks/
│   │   └── useMediasoup.ts       # WebRTC hook — produce, consume, retry connect, echo fix
│   ├── components/               # Shared UI components (shadcn/ui)
│   ├── contexts/
│   │   └── AuthContext.tsx       # JWT auth state
│   └── lib/
│       ├── prisma.ts             # Prisma client singleton
│       └── auth.ts               # JWT helpers
├── server.ts                     # mediasoup SFU + Socket.IO server (port 3001)
├── prisma/
│   ├── schema.prisma             # Database schema (User, Session, Message, Recording)
│   └── seed.ts                   # Demo account seeder
├── dist/
│   └── server.js                 # Compiled SFU server (production)
├── tsconfig.json                 # Next.js TypeScript config
├── tsconfig.server.json          # Server-only TypeScript config (CJS output)
├── next.config.ts                # Next.js config (standalone output, CORS)
├── open-firewall-ports.ps1       # Windows firewall setup for WebRTC ports
├── start.ps1                     # Windows one-click production launcher
├── start.sh                      # Linux/macOS one-click production launcher
└── .env.example                  # Environment variable template
```

---

## 📜 npm Scripts Reference

| Script | Description |
|---|---|
| `npm run dev:all` | Start both Next.js + SFU in development (Turbopack HMR) |
| `npm run dev` | Start Next.js only |
| `npm run dev:server` | Start SFU only |
| `npm run build` | Full production build (Next.js + SFU server) |
| `npm run build:next` | Build Next.js only (runs `prisma generate` first) |
| `npm run build:server` | Compile `server.ts` → `dist/server.js` |
| `npm run start:prod` | Start both in production mode |
| `npm run start:next` | Start Next.js standalone server only |
| `npm run start:server` | Start compiled SFU server only |
| `npm run setup` | `db:push` + `seed` (first-time DB setup) |
| `npm run db:push` | Push Prisma schema to database |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run seed` | Seed demo accounts |

---

## 🌐 Supported Browsers

| Browser | Voice | Video | Notes |
|---|---|---|---|
| Chrome / Edge (desktop) | ✅ | ✅ | Best experience |
| Firefox (desktop) | ✅ | ✅ | Full support |
| Safari (desktop) | ✅ | ✅ | macOS 13+ |
| Chrome (Android) | ✅ | ✅ | Camera switch supported |
| Safari (iOS) | ✅ | ✅ | iOS 16+ |

---

## 📄 License

Built for the **AtomQuest Hackathon 2026**. All rights reserved — **Team Techy Play**.
