# ConnectDesk — Real-Time Video Support Platform

**AtomQuest Hackathon 1.0 — Grand Finale Submission**

A full-featured, enterprise-grade customer support platform with a tiered support escalation model (Chat → Voice → Video), server-routed WebRTC media, real-time chat, file sharing, session management, and automated recording.

---

## Tiered Support Architecture

Sessions follow a **customer-support-first** model with three escalation tiers:

```
Level 1 — Chat Support   (default on join)
  ↓ "Start Voice Support"
Level 2 — Voice Support  (mic permission requested)
  ↓ Agent: "Request Customer Camera"  /  Customer: "Enable My Camera"
Level 3 — Video Support  (cam + mic, customer approves agent request)
```

- **Joining a session never requires camera or microphone permissions**
- Chat is available immediately upon connection
- Voice and video are opt-in and can be enabled/disabled at any time
- Agent can request the customer's camera; customer approves or declines
- Declined camera does not disconnect the session

---

## Features

### Session Management
- Agent creates a session → gets a shareable invite link
- Customer joins via invite link (no account required)
- Real-time participant list tracking
- Session history persisted to database (PostgreSQL via Prisma)
- Agent-only session termination (customers can leave, not end)
- Session duration tracking

### Chat Support (Level 1 — Always Available)
- Real-time messaging via Socket.IO relay
- Image sharing (JPEG, PNG, GIF, WebP) — displayed inline
- PDF sharing — opens in Google Drive viewer
- Messages persisted to database
- Message history loaded on join
- Works without any camera/mic permission

### Voice Support (Level 2 — On-Demand)
- User clicks "Start Voice Support" button
- Microphone permission requested only at this point
- If denied: non-blocking warning shown, session continues
- Audio published via mediasoup SFU (server-routed — no P2P)
- Mute/unmute control during call

### Video Support (Level 3 — Escalated)
- **Agent-initiated**: "Request Customer Camera" button sends dialog to customer
- **Customer-initiated**: "Enable My Camera" self-escalation button
- Customer sees permission dialog: "Allow Video Support" / "Decline"
- If customer declines: session continues (chat + voice still active)
- If camera unavailable: non-blocking warning, session continues
- Camera + mic requested together via `getUserMedia`
- Video published via mediasoup SFU (server-routed — no P2P)

### Recording (Agent Only — Automatic)
- Starts automatically when customer video stream is active
- Records **customer stream only** (agent never recorded)
- Uploaded to Cloudinary after session ends
- Download link provided to agent
- Status indicator: Recording → Processing → Ready / Failed

### Media Controls
- Mute/Unmute audio (visible in voice/video mode)
- Camera on/off toggle (visible in video mode only)
- Stop all media (return to chat mode)
- End/Leave session button always visible

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  CLIENT (Browser)                   │
│  Next.js 15 + React + Tailwind CSS + shadcn/ui      │
│  next-themes · mediasoup-client · Socket.IO-client  │
└────────────┬──────────────────────────┬─────────────┘
             │ HTTP/REST                │ WebSocket + WebRTC
             ▼                         ▼
┌────────────────────┐    ┌───────────────────────────┐
│ Next.js API Routes │    │   mediasoup SFU Server    │
│ (port 3000)        │    │   Socket.IO + mediasoup   │
│                    │    │   (port 3001)             │
│ /api/sessions      │    │                           │
│ /api/auth          │    │ Room management           │
│ /api/upload        │    │ WebRTC transport mgmt     │
│ /api/recordings    │    │ Video request relay       │
│ /api/history       │    │ Chat relay                │
└────────────┬───────┘    └───────────────────────────┘
             │
      ┌──────┴───────┐
      │  PostgreSQL  │
      │  (Prisma)    │
      │              │
      │ Sessions     │
      │ Messages     │
      │ Recordings   │
      │ Users        │
      └──────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (Turbopack), React 19, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui, next-themes |
| WebRTC SFU | mediasoup v3 (server-routed, no P2P) |
| Real-time | Socket.IO (polling + websocket transport) |
| Database | PostgreSQL + Prisma ORM |
| File Storage | Cloudinary (images, PDFs, recordings) |
| Auth | JWT-based (NextAuth pattern) |
| Dev | Concurrently (Next.js + SFU in one command) |

---

## Prerequisites

- Node.js 18+
- PostgreSQL database
- Cloudinary account (for file uploads)
- Gmail account with App Password (for invite emails)

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd video-support-platform
npm install
```

### 2. Configure environment

Create `.env` in the project root:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/connectdesk"

# Auth
NEXTAUTH_SECRET="your-secret-here"
NEXTAUTH_URL="http://localhost:3000"

# Cloudinary (file uploads + recording storage)
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME="your-cloud-name"
CLOUDINARY_API_KEY="your-api-key"
CLOUDINARY_API_SECRET="your-api-secret"

# Email (invite links)
EMAIL_USER="lokesh97198@gmail.com"
EMAIL_PASS="your-gmail-app-password"

# SFU Server (optional override)
NEXT_PUBLIC_SOCKET_URL="http://localhost:3001"
```

### 3. Set up database

```bash
npx prisma generate
npx prisma db push
```

### 4. Run development server

```bash
npm run dev:all
```

This runs both Next.js (port 3000) and the mediasoup SFU server (port 3001) concurrently.

---

## Running (Two Terminals)

**Terminal 1 — Next.js:**
```bash
npm run dev
```

**Terminal 2 — SFU Server:**
```bash
npx ts-node server.ts
```

Or use the combined command:
```bash
npm run dev:all
```

---

## Local Network (Mobile Testing)

Access from your phone on the same WiFi:

```
http://192.168.1.30:3000
```

The app is configured to allow LAN access via `allowedDevOrigins` in `next.config.ts`.

---

## User Roles

| Role | Capabilities |
|---|---|
| **AGENT** | Create sessions, send invites, end sessions, request customer camera, view recordings |
| **CUSTOMER** | Join via invite link, chat, start voice/video, approve/decline video requests |
| **ADMIN** | Same as AGENT + dashboard access |

---

## Session Flow

```
Agent                          Customer
  │                               │
  │── Create Session ─────────────│
  │── Send Invite Email ──────────│
  │                               │── Open invite link
  │── Both auto-join ─────────────│── Both auto-join
  │                               │
  │◄──── Chat Support (default) ──►│
  │                               │
  │── "Start Voice Support" ──────│ (or customer does the same)
  │◄──── Voice Support ───────────►│
  │                               │
  │── "Request Customer Camera" ──►│ ← Dialog appears
  │                               │── "Allow" → cam+mic enabled
  │◄──── Video Support ───────────►│
  │                               │
  │── Recording starts automatically (customer stream only)
  │                               │
  │── "End Session" ──────────────│── Both redirected
  │── Recording uploaded ─────────│
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login |
| GET | `/api/sessions` | List agent sessions |
| POST | `/api/sessions` | Create new session |
| GET | `/api/sessions/:id` | Get session + messages |
| PATCH | `/api/sessions/:id` | Update session status |
| POST | `/api/sessions/:id/invite` | Send email invite |
| POST | `/api/sessions/:id/messages` | Persist chat message |
| POST | `/api/upload` | Upload file to Cloudinary |
| POST | `/api/recordings/:id` | Save recording metadata |
| GET | `/api/history` | Session history |

---

## Implemented Features Checklist

- [x] Session creation with shareable invite links
- [x] Guest join (customer joins without account via link)
- [x] Real-time participant list
- [x] Agent-only session termination
- [x] Session history with duration
- [x] Real-time chat (Socket.IO)
- [x] Image sharing (inline preview)
- [x] PDF sharing (Google Drive viewer)
- [x] File upload via Cloudinary
- [x] Server-routed audio (mediasoup SFU)
- [x] Server-routed video (mediasoup SFU)
- [x] Mute/unmute controls
- [x] Camera on/off controls
- [x] Join without camera/mic (chat-first)
- [x] Voice escalation (on-demand mic)
- [x] Agent-requested customer video
- [x] Customer video approval dialog
- [x] Non-blocking media errors (session never blocked)
- [x] Auto recording (customer stream, agent-visible only)
- [x] Recording upload to Cloudinary
- [x] Dark/Light theme toggle
- [x] LAN access (192.168.x.x) for mobile testing
- [x] Concurrent dev script (Next.js + SFU)
