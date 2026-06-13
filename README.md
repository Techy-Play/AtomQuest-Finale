# ConnectDesk — Real-Time Video Support Platform

**AtomQuest Hackathon 1.0 — Grand Finale Submission**

A full-featured, enterprise-grade video support platform where support agents can conduct and review video-assisted support sessions with customers — all running through your own server-routed infrastructure.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                  │
│  Next.js 15 + React + Tailwind CSS + shadcn/ui       │
│  next-themes (Dark/Light) + mediasoup-client         │
└──────────┬────────────────────┬──────────────────────┘
           │ HTTP/REST           │ WebSocket + WebRTC
           ▼                     ▼
┌────────────────────┐  ┌────────────────────────────┐
│  Next.js API Routes│  │  mediasoup SFU Server       │
│  (Port 3000)       │  │  + Socket.IO (Port 3001)    │
│                    │  │                             │
│  Auth, Sessions,   │  │  Server-Routed Media        │
│  Chat, History     │  │  Signaling, Chat Relay      │
└────────┬───────────┘  └────────────────────────────┘
         │
         ▼
┌────────────────────┐
│  Neon PostgreSQL   │
│  (via Prisma ORM)  │
└────────────────────┘
```

### Key Design: Server-Routed Media

All video/audio streams route through the **mediasoup SFU** (Selective Forwarding Unit). No peer-to-peer connections.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, Tailwind CSS v4, shadcn/ui, next-themes (Responsive Light/Dark Mode) |
| Backend | Next.js API Routes (REST) |
| Database | Neon PostgreSQL + Prisma 7 ORM |
| Video/Audio | WebRTC via **mediasoup** (SFU) |
| Real-time | Socket.IO (signaling + chat) |
| Auth | JWT cookies + bcrypt |

---

## Features

### Must-Have (All Complete)
- **Session Management** — Create sessions, shareable invite links, join via token
- **Video & Audio Calling** — HD video/audio routed through mediasoup SFU
- **In-Call Chat** — Real-time messages, persisted, viewable after call
- **User Roles** — Agent (create/end), Customer (join)
- **Session History** — Event logs, chat transcripts, duration tracking

### Production Readiness
- **Responsive UI** — Fully responsive interfaces for mobile and desktop
- **Theming** — System-aware Light and Dark mode toggles
- **Stability** — Resolved React hydration issues and `NotReadableError` media device conflicts. Pre-join lobby implemented for optimal camera lifecycle management.

---

## Setup

### Prerequisites
- Node.js 18+
- npm

### 1. Install

```bash
npm install
```

### 2. Database

```bash
npx prisma migrate dev --name init
npx prisma generate
npx tsx prisma/seed.ts
```

### 3. Run (Two Terminals)

**Terminal 1 — Frontend + API:**
```bash
npm run dev
```

**Terminal 2 — mediasoup SFU:**
```bash
npm run dev:server
```

- Frontend: http://localhost:3000
- SFU: ws://localhost:3001

---

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Agent | agent@atomquest.com | agent123 |
| Customer | customer@example.com | customer123 |

Quick-login buttons on the login page.

---

## Demo Flow

1. **Agent** logs in → creates session → copies invite link
2. **Customer** opens invite link or enters token in dashboard → joins session
3. Both join through the Pre-Join Lobby
4. Both see each other on video (server-routed)
5. Chat in real-time (persisted)
6. Agent ends call → history available

---

Built for **AtomQuest Hackathon 1.0**
