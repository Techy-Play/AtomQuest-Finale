# ConnectDesk — Real-Time Video Support Platform

**AtomQuest Hackathon 1.0 — Grand Finale Submission**

A full-featured, enterprise-grade customer support platform with a tiered escalation model (Chat → Voice → Video), server-routed WebRTC media via mediasoup SFU, real-time chat, file sharing, automated call recording, and full LAN/mobile support for laptop + phone demonstrations.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up database
npx prisma db push

# 3. Start both servers (Next.js + SFU)
npm run dev:all
```

**Laptop (Agent):** http://localhost:3000
**Mobile (Customer):** http://192.168.x.x:3000 *(your machine's LAN IP, shown in the SFU startup log)*

---

## Tiered Support Architecture

Sessions follow a **customer-support-first** escalation model — joining never requires camera or microphone access.

```
Level 1 ─ Chat Support     (default on join, no media needed)
    │
    ▼  click "Start Voice Support"
Level 2 ─ Voice Support    (mic permission requested on demand)
    │
    ▼  Agent: "Request Customer Camera"  OR  Customer: "Enable My Camera"
Level 3 ─ Video Support    (cam + mic, customer approves agent request)
```

Key principles:
- **Joining is always instant** — no permission prompt on page load
- **Media errors are non-blocking** — a dismissable warning shows, session continues
- **Customers always decide** — agent can request, never force, video

---

## Features

### Session Management
- Agent creates a session and sends a shareable invite link via email
- Customer joins via invite link — no account required
- Real-time participant list tracking
- Session history persisted to PostgreSQL via Prisma
- Agent-only session termination; customers can leave without ending the session
- Live session duration timer

### Chat Support — Level 1 (Always Available)
- Real-time messaging via Socket.IO relay
- Inline image display (JPEG, PNG, GIF, WebP)
- PDF sharing — opens in Google Drive viewer
- File attach button (images + PDFs)
- Message history loaded on join from database
- Works with zero camera/mic permission

### Voice Support — Level 2 (On-Demand)
- "Start Voice Support" button triggers mic permission
- If denied: non-blocking amber warning, session stays in chat mode
- Audio published through mediasoup SFU (server-routed, no P2P)
- Mute/unmute toggle during call

### Video Support — Level 3 (Escalated)
- **Agent-initiated:** "Request Customer Camera" → dialog appears on customer's screen
- **Customer self-serve:** "Enable My Camera" button
- Customer dialog: Allow / Decline — declining never disconnects the session
- Camera + mic captured together via `getUserMedia`
- Video published through mediasoup SFU (server-routed, no P2P)

### Call Recording (Agent-Visible Only)
- Starts automatically when the customer's video stream is active
- Records **customer stream only** — agent is never recorded
- Uploaded to Cloudinary after session ends
- Download link shown in the agent's recording status bar
- Status: `Recording` → `Processing` → `Ready` / `Failed`
- Completely hidden from the customer side

### LAN / Mobile Support
- Socket.IO server listens on `0.0.0.0` — reachable from any device on the network
- mediasoup auto-detects the machine's LAN IP for ICE candidate announcements — no manual config needed
- Next.js runs on `-H 0.0.0.0` — accessible from mobile browsers
- All socket URLs derived dynamically from `window.location.hostname` — no hardcoded `localhost`
- Invite links generated from the request `Host` header — work correctly on LAN

### Connection Status UI
- 4-state socket indicator in the session header: `Connecting` / `Connected` / `Disconnected` / `Failed`
- Dev mode: active hostname displayed in header (e.g. `192.168.1.30`)
- Connecting overlay shows which server is being contacted
- Error dialog shows the attempted socket URL for easy debugging

### Dev Logging (Browser Console)
In development, the console prints:
```
[ConnectDesk] Socket Connection
  Frontend hostname : 192.168.1.30
  Socket URL        : http://192.168.1.30:3001
  Session ID        : cma...
  User role         : CUSTOMER
[ConnectDesk] Joined room: cma... | Peers: 1
[ConnectDesk] Peer joined: Support Agent | Role: AGENT
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   CLIENT (Browser)                       │
│  Next.js 15 + React 19 + TypeScript                      │
│  Tailwind CSS v4 · shadcn/ui · next-themes               │
│  mediasoup-client · Socket.IO-client                     │
│                                                          │
│  URL detection: window.location.hostname                 │
│  → works on localhost AND 192.168.x.x automatically     │
└──────────┬───────────────────────────┬───────────────────┘
           │ HTTP/REST                 │ WebSocket
           ▼                           ▼
┌──────────────────────┐  ┌───────────────────────────────┐
│  Next.js API Routes  │  │  mediasoup SFU Server         │
│  (port 3000)         │  │  (port 3001, 0.0.0.0)         │
│                      │  │                               │
│  /api/sessions       │  │  Listens: 0.0.0.0:3001        │
│  /api/auth           │  │  ICE addr: auto-detected LAN  │
│  /api/upload         │  │  Transports: polling+ws       │
│  /api/recordings     │  │                               │
│  /api/history        │  │  Events:                      │
└──────────┬───────────┘  │  join-room, produce, consume  │
           │              │  chat-message, media-state    │
    ┌──────┴──────┐       │  request-customer-video       │
    │ PostgreSQL  │       │  video-request-response       │
    │  (Prisma)   │       └───────────────────────────────┘
    │             │
    │ Sessions    │
    │ Messages    │
    │ Recordings  │
    │ Users       │
    └─────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (Turbopack), React 19, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui, next-themes |
| WebRTC SFU | mediasoup v3 — server-routed, no peer-to-peer |
| Real-time | Socket.IO (polling + websocket fallback) |
| Database | PostgreSQL + Prisma ORM (hosted on Neon) |
| File Storage | Cloudinary (images, PDFs, session recordings) |
| Auth | JWT — cookie-based, server-validated |
| Dev tooling | Concurrently, tsx, ESLint |

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | Required for mediasoup |
| PostgreSQL | Neon serverless works out of the box |
| Cloudinary account | Free tier is sufficient for demo |
| Gmail App Password | For email invite links |

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL="postgresql://user:password@host/db?sslmode=require"

# Auth
JWT_SECRET="your-secret-here"

# Cloudinary (file uploads + recording storage)
CLOUDINARY_CLOUD_NAME="your-cloud-name"
CLOUDINARY_API_KEY="your-api-key"
CLOUDINARY_API_SECRET="your-api-secret"

# Email (Gmail App Password)
EMAIL_HOST="smtp.gmail.com"
EMAIL_PORT="587"
EMAIL_USER="you@gmail.com"
EMAIL_PASS="xxxx xxxx xxxx xxxx"

# --- OPTIONAL OVERRIDES ---
# Leave these commented out for automatic LAN detection.
# Set them only when deploying to a fixed domain.
# NEXT_PUBLIC_APP_URL="https://your-domain.com"
# NEXT_PUBLIC_SOCKET_URL="https://your-domain.com"

# Set this only if LAN IP auto-detection picks the wrong interface.
# MEDIASOUP_ANNOUNCED_IP="192.168.1.30"
```

> **Important:** `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SOCKET_URL` are intentionally left unset. The app derives both from `window.location.hostname` at runtime, making it work on `localhost` *and* any LAN IP without code changes.

---

## Setup

```bash
# Clone
git clone <repo-url>
cd video-support-platform

# Install
npm install

# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# (Optional) Seed initial agent account
npm run seed
```

---

## Running

### Combined (recommended)
```bash
npm run dev:all
```
Starts both Next.js and the mediasoup SFU server concurrently with color-coded output.

### Split terminals
```bash
# Terminal 1 — Next.js frontend
npm run dev

# Terminal 2 — mediasoup SFU server
npm run dev:server
```

### Startup output
When both servers are running you will see:
```
╔═══════════════════════════════════════════════════════╗
║  🎥  mediasoup SFU + Socket.IO Server                 ║
║  📡  Laptop : http://localhost:3001                   ║
║  📱  Mobile : http://192.168.1.30:3001               ║
║  🔌  Server-routed media — announcedIP: 192.168.1.30 ║
╚═══════════════════════════════════════════════════════╝
```
The LAN IP is auto-detected — no manual configuration needed.

---

## Laptop + Mobile Demo Setup

This is the primary testing configuration:

```
Agent  → Laptop  → Chrome → http://localhost:3000
Customer → Phone → Safari/Chrome → http://192.168.1.30:3000
```

Both devices must be on the **same Wi-Fi network**.

**Step-by-step:**

1. Run `npm run dev:all` on the laptop
2. Note the LAN IP shown in the SFU startup log (e.g. `192.168.1.30`)
3. On the laptop, open `http://localhost:3000` → log in as Agent
4. Create a new session → copy the invite link
5. On the phone, open the invite link (it will use the LAN IP automatically)
6. Customer joins → both are now in the session

**What works from mobile:**
- ✅ Socket.IO connects to the correct server
- ✅ Chat messages send and receive in real time
- ✅ File/image/PDF sharing
- ✅ Presence updates (participant list)
- ✅ Voice support (mic on mobile)
- ✅ Video support (camera on mobile, after agent requests)

---

## User Roles

| Role | Can Do |
|---|---|
| **AGENT** | Create sessions, send email invites, end sessions, request customer camera, view recording status + download |
| **CUSTOMER** | Join via invite link (no account needed), chat, start voice/video, approve or decline video requests |
| **ADMIN** | Same as AGENT plus admin dashboard |

---

## Session Flow

```
Agent (Laptop)                        Customer (Mobile)
      │                                      │
      │── Create session ────────────────────┤
      │── Send invite email ─────────────────┤
      │                                      │── Open invite link
      │                                      │── Auto-join (no media prompt)
      │── Auto-join (no media prompt) ───────┤
      │                                      │
      │◄════════ Chat Support (default) ════►│
      │                                      │
      │── "Start Voice Support" ─────────────┤  (or customer does the same)
      │◄════════ Voice Support ══════════════►│
      │                                      │
      │── "Request Customer Camera" ─────────►│ ← Dialog: Allow / Decline
      │                                      │── Allow → cam+mic captured
      │◄════════ Video Support ══════════════►│
      │                                      │
      │── Recording starts (customer only) ──┤
      │                                      │
      │── "End Session" ─────────────────────►│ ← both redirected
      │── Recording uploaded to Cloudinary ──┤
      │── Download link shown to agent ──────┤
```

---

## API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | None | Register new user |
| POST | `/api/auth/login` | None | Login, sets JWT cookie |
| POST | `/api/auth/logout` | None | Clear cookie |
| GET | `/api/auth/me` | Required | Get current user |
| GET | `/api/sessions` | Agent | List agent's sessions |
| POST | `/api/sessions/invite` | Agent | Create session + send email |
| POST | `/api/sessions/join` | None | Join via invite token |
| GET | `/api/sessions/:id` | Required | Get session with messages |
| PATCH | `/api/sessions/:id` | Agent | Update session status |
| POST | `/api/sessions/:id/messages` | Required | Persist chat message |
| POST | `/api/upload` | Required | Upload file to Cloudinary |
| POST | `/api/recordings/:id` | Agent | Save recording metadata/URL |
| GET | `/api/history` | Required | Session history |

---

## Socket.IO Events

| Direction | Event | Payload | Description |
|---|---|---|---|
| Client → Server | `join-room` | `{sessionId, userId, name, role}` | Join session room |
| Client → Server | `create-transport` | `{sessionId, direction}` | Create WebRTC transport |
| Client → Server | `connect-transport` | `{sessionId, transportId, dtlsParameters}` | Connect transport |
| Client → Server | `produce` | `{sessionId, transportId, kind, rtpParameters}` | Publish media track |
| Client → Server | `consume` | `{sessionId, transportId, producerId, rtpCapabilities}` | Subscribe to track |
| Client → Server | `resume-consumer` | `{sessionId, consumerId}` | Resume paused consumer |
| Client → Server | `chat-message` | `{sessionId, message}` | Send chat message |
| Client → Server | `media-state-change` | `{sessionId, kind, enabled}` | Toggle mute/video |
| Client → Server | `request-customer-video` | `{sessionId}` | Agent requests customer cam |
| Client → Server | `video-request-response` | `{sessionId, accepted}` | Customer responds |
| Client → Server | `end-session` | `{sessionId}` | End session for all |
| Server → Client | `peer-joined` | `{socketId, userId, name, role}` | New participant |
| Server → Client | `peer-left` | `{socketId}` | Participant disconnected |
| Server → Client | `new-producer` | `{producerId, socketId}` | New media track available |
| Server → Client | `chat-message` | `ChatMsg` | Relayed message |
| Server → Client | `media-state-change` | `{socketId, kind, enabled}` | Peer mute state |
| Server → Client | `video-request` | — | Customer: agent requested cam |
| Server → Client | `video-request-accepted` | — | Agent: customer approved |
| Server → Client | `video-request-declined` | — | Agent: customer declined |
| Server → Client | `session-ended` | — | Session terminated |

---

## Feature Checklist

- [x] Session creation with shareable invite links
- [x] Guest join — customer joins without an account
- [x] Real-time participant list
- [x] Agent-only session termination
- [x] Session history with duration tracking
- [x] Real-time chat (Socket.IO)
- [x] Inline image display (JPEG, PNG, GIF, WebP)
- [x] PDF sharing via Google Drive viewer
- [x] File upload via Cloudinary
- [x] Chat-first join (no media prompt on page load)
- [x] Voice escalation — mic requested on demand
- [x] Agent-initiated video request with customer approval dialog
- [x] Customer self-serve video escalation
- [x] Non-blocking media errors — session never interrupted
- [x] Server-routed audio via mediasoup SFU (no P2P)
- [x] Server-routed video via mediasoup SFU (no P2P)
- [x] Mute/unmute audio control
- [x] Camera on/off control
- [x] Stop media — return to chat mode without leaving session
- [x] Auto recording of customer stream (agent-visible only)
- [x] Recording upload to Cloudinary post-session
- [x] Recording download link for agent
- [x] Dark / Light theme toggle
- [x] LAN support — mobile + laptop on same Wi-Fi
- [x] Auto LAN IP detection for mediasoup ICE candidates
- [x] Dynamic socket URL — no hardcoded localhost
- [x] 4-state connection status indicator in UI
- [x] Dev-mode debug logging in browser console
- [x] Email invite with correct LAN-aware join URL
