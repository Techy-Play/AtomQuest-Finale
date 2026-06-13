# ConnectDesk — Real-Time Video Support Platform

> A full-stack customer support platform with live chat, voice calls, and HD video sessions — built for the **AtomQuest Hackathon**.

![ConnectDesk Banner](https://img.shields.io/badge/ConnectDesk-Video%20Support-6366f1?style=for-the-badge&logo=webrtc)
![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)
![mediasoup](https://img.shields.io/badge/mediasoup-SFU-ff6b35?style=flat-square)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Setup & Installation](#-setup--installation)
- [Environment Variables](#-environment-variables)
- [Running Locally](#-running-locally)
- [Mobile / LAN Access](#-mobile--lan-access)
- [Usage Guide](#-usage-guide)
- [Project Structure](#-project-structure)

---

## 🚀 Overview

ConnectDesk is a **customer support platform** that mirrors real enterprise systems like Intercom and Zendesk. An agent creates a support session and invites a customer via a unique link. The session escalates from chat → voice → video as needed. All media is routed through a **mediasoup SFU** (Selective Forwarding Unit) for low-latency, server-side WebRTC.

---

## ✨ Features

### 👤 Agent
- Dashboard to **create, manage and monitor** support sessions
- Invite customers via **email** or **shareable link**
- Escalate sessions: **Chat → Voice → Video** (agent-initiated)
- **Mute / unmute** audio and toggle camera at any time
- **Manual recording** — start/stop recording at any time; stored to cloud (Cloudinary)
- Deep-link **session history** page with tabs for Chat, Files, Recordings, and Event Log

### 👥 Customer
- Join via invite link — no account required (guest join)
- **Real-time chat** with file & image sharing
- Accept/decline incoming voice and video calls
- **Camera switch** (front ↔ back) on mobile
- Mute audio or turn off camera independently

### 🎥 Media Engine
- **mediasoup SFU** — server-routed WebRTC (no P2P, works behind NAT/firewalls)
- Automatic **SFU reconnect** with retry logic (up to 8 attempts, 3s apart)
- **Echo cancellation** — `echoCancellation`, `noiseSuppression`, `autoGainControl` + Chrome mobile extended constraints
- Stale consumer cleanup per-peer to prevent audio doubling
- `object-contain` video layout — portrait mobile cameras are never cropped

### 📜 Session History
- Chat history retrievable after session ends
- Shared files browsable with image preview
- Recordings stored to Cloudinary, downloadable from the history page
- Full event log (joined, started, ended, escalated)

---

## 🏗️ Architecture

```
Browser (Next.js 16)
    │
    ├─── REST API (Next.js App Router /api/*)
    │       ├── /api/sessions       — CRUD sessions
    │       ├── /api/sessions/invite — create + email invite
    │       ├── /api/sessions/join  — guest join via token
    │       ├── /api/recordings     — save/list recordings
    │       └── /api/upload         — Cloudinary file upload
    │
    └─── Socket.IO + mediasoup SFU (server.ts on :3001)
            ├── join-room           — load mediasoup Device
            ├── create-transport    — WebRTC transport setup
            ├── produce             — publish local audio/video
            ├── consume             — subscribe to remote stream
            └── resume-consumer     — unpause consumer after ICE
```

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| **WebRTC SFU** | mediasoup v3 + Socket.IO v4 |
| **Database** | PostgreSQL + Prisma ORM |
| **Auth** | JWT (HttpOnly cookie) |
| **File Storage** | Cloudinary |
| **Email** | Nodemailer (SMTP) |
| **Dev runner** | concurrently (`npm run dev:all`) |

---

## 📦 Prerequisites

- **Node.js** ≥ 18  
- **npm** ≥ 9  
- **PostgreSQL** (local or hosted — e.g. Neon, Supabase)  
- **Cloudinary** account (free tier works)  
- **SMTP** credentials (Gmail App Password works)  
- Windows users: Python + Visual C++ Build Tools (for mediasoup native build)

### Install Windows Build Tools (first time only)

```powershell
# Run PowerShell as Administrator
npm install --global windows-build-tools
# OR install manually:
# https://visualstudio.microsoft.com/visual-cpp-build-tools/
```

---

## ⚙️ Setup & Installation

### 1. Clone the repository

```bash
git clone https://github.com/Techy-Play/AtomQuest-Finale.git
cd AtomQuest-Finale/video-support-platform
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` — see [Environment Variables](#-environment-variables) below.

### 4. Set up the database

```bash
# Push schema to your PostgreSQL database
npx prisma db push

# (Optional) seed an admin/agent account
npx prisma db seed
```

### 5. Open firewall ports (Windows — for mobile access on same WiFi)

```powershell
# Run as Administrator
.\open-firewall-ports.ps1
```

This opens TCP 3001 and UDP 10000–10100 for the mediasoup SFU.

---

## 🔑 Environment Variables

Create a `.env` file in `video-support-platform/`:

```env
# ── Database ──────────────────────────────────────────────
DATABASE_URL="postgresql://user:password@localhost:5432/connectdesk"

# ── Auth ──────────────────────────────────────────────────
JWT_SECRET="your-super-secret-jwt-key-change-this"

# ── Cloudinary (file + recording storage) ─────────────────
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"

# ── Email (SMTP) ───────────────────────────────────────────
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your@gmail.com"
SMTP_PASS="your_app_password"         # Gmail → Settings → App Passwords

# ── SFU Networking ────────────────────────────────────────
# Set this to your LAN IP so mobile devices can reach the SFU
# Find it with: ipconfig (Windows) or ip addr (Linux)
MEDIASOUP_ANNOUNCED_IP="192.168.1.X"  # Your laptop's WiFi IP

# ── App URL (optional) ────────────────────────────────────
# Only needed if deploying to a custom domain
# NEXT_PUBLIC_APP_URL="https://your-domain.com"
```

---

## ▶️ Running Locally

```bash
# Starts both Next.js (port 3000) and mediasoup SFU (port 3001) together
npm run dev:all
```

Then open:
- **Agent dashboard**: http://localhost:3000
- **Customer join**: http://localhost:3000/join/[token]

> **Note:** The SFU takes ~5 seconds to start after Next.js. The session page will show **"Connecting…"** and automatically retry — no manual refresh needed.

---

## 📱 Mobile / LAN Access

To test with a real mobile device on the same WiFi:

1. Find your laptop's LAN IP:
   ```powershell
   ipconfig
   # Look for: IPv4 Address . . . : 192.168.1.X
   ```

2. Set it in `.env`:
   ```env
   MEDIASOUP_ANNOUNCED_IP=192.168.1.X
   ```

3. Run the firewall script (**as Administrator**):
   ```powershell
   .\open-firewall-ports.ps1
   ```

4. On mobile, open: `http://192.168.1.X:3000`

---

## 🧭 Usage Guide

### As an Agent

1. Go to `http://localhost:3000` → **Login** (create account if first time)
2. Click **New Session** → enter a title
3. Choose to invite by **email** or copy the **invite link**
4. Click **Join Call** to enter the session
5. Chat with the customer. Escalate when needed:
   - Click **Start Voice Support** to begin a voice call
   - Click **Request Customer Camera** to ask for video
6. Use the **recording bar** at the bottom to **Start / Stop Recording**
7. After the session, go to **History** → view chat, files, and recordings

### As a Customer

1. Open the invite link (e.g. `http://192.168.1.X:3000/join/TOKEN`)
2. Enter your name → **Join Session**
3. Chat with the agent
4. When prompted for voice/video, accept or decline
5. Use the **mute** and **camera** buttons in the controls bar
6. On mobile, tap **Switch Camera** (🔄) to toggle front/back camera

---

## 📁 Project Structure

```
video-support-platform/
├── src/
│   ├── app/
│   │   ├── agent/          # Agent dashboard
│   │   ├── customer/       # Customer dashboard
│   │   ├── session/[id]/   # Live session page (chat + video)
│   │   ├── history/[id]/   # Session history (chat, files, recordings)
│   │   ├── join/           # Customer invite join flow
│   │   └── api/            # REST API routes
│   ├── hooks/
│   │   └── useMediasoup.ts # WebRTC media hook (produce/consume)
│   ├── components/         # UI components (shadcn/ui based)
│   ├── contexts/           # AuthContext
│   └── lib/                # Prisma client, auth helpers
├── server.ts               # mediasoup SFU + Socket.IO server (port 3001)
├── prisma/
│   └── schema.prisma       # Database schema
├── open-firewall-ports.ps1 # Windows firewall setup script
└── .env                    # Environment config (not committed)
```

---

## 📄 License

Built for the **AtomQuest Hackathon 2026**. All rights reserved.
