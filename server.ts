// Standalone Socket.IO + mediasoup SFU Server
// Runs on port 3001 alongside Next.js on port 3000

import { createServer } from 'http';
import { networkInterfaces } from 'os';
import { Server as SocketIOServer } from 'socket.io';
import * as mediasoup from 'mediasoup';
import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  RtpCodecCapability,
} from 'mediasoup/node/lib/types';

const port = parseInt(process.env.SOCKET_PORT || '3001', 10);

// Auto-detect LAN IP for mediasoup ICE candidate announcement.
// When MEDIASOUP_ANNOUNCED_IP is not set, we find the first non-loopback
// IPv4 address (e.g. 192.168.1.30) so mobile devices can reach us.
function getLanIp(): string {
  if (process.env.MEDIASOUP_ANNOUNCED_IP) return process.env.MEDIASOUP_ANNOUNCED_IP;
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address; // e.g. 192.168.1.30
      }
    }
  }
  return '127.0.0.1'; // fallback
}

const LAN_IP = getLanIp();

// mediasoup configuration
const mediaCodecs: RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
  },
];

// Peer / Room state
interface Peer {
  socketId: string;
  userId: string;
  name: string;
  role: string;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

interface Room {
  sessionId: string;
  router: Router | null;
  peers: Map<string, Peer>;
}

const rooms = new Map<string, Room>();
let worker: Worker;
let workerReady = false;

// Waits for the mediasoup worker to be ready before proceeding.
// Prevents "Failed to join room" errors when clients connect during startup.
function waitForWorker(): Promise<void> {
  return new Promise((resolve) => {
    if (workerReady) { resolve(); return; }
    const interval = setInterval(() => {
      if (workerReady) { clearInterval(interval); resolve(); }
    }, 100);
  });
}

async function createMediasoupWorker(): Promise<Worker> {
  const w = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });
  console.log('✅ mediasoup Worker created [pid:%d]', w.pid);
  w.on('died', () => {
    console.error('❌ mediasoup Worker died, exiting...');
    process.exit(1);
  });
  return w;
}

async function getOrCreateRoom(sessionId: string): Promise<Room> {
  await waitForWorker(); // guard against startup race
  let room = rooms.get(sessionId);
  if (room) return room;
  const router = await worker.createRouter({ mediaCodecs });
  room = { sessionId, router, peers: new Map() };
  rooms.set(sessionId, room);
  console.log(`🎬 Room created: ${sessionId}`);
  return room;
}

async function createWebRtcTransport(router: Router): Promise<WebRtcTransport> {
  return router.createWebRtcTransport({
    listenInfos: [
      // Announce our LAN IP so mobile clients receive a reachable ICE candidate
      { protocol: 'udp', ip: '0.0.0.0', announcedAddress: LAN_IP },
      { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: LAN_IP },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1000000,
  });
}

async function main() {
  worker = await createMediasoupWorker();
  workerReady = true;
  console.log('✅ mediasoup worker ready — accepting connections');

  const httpServer = createServer();
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: false,
    },
    path: '/socket.io',
    transports: ['polling', 'websocket'],
    allowEIO3: true,
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);
    let currentSessionId: string | null = null;
    let currentUserId: string | null = null;

    socket.on('join-room', async (data: { sessionId: string; userId: string; name: string; role: string }, cb) => {
      try {
        const { sessionId, userId, name, role } = data;
        currentSessionId = sessionId;
        currentUserId = userId;
        const room = await getOrCreateRoom(sessionId);

        const peer: Peer = {
          socketId: socket.id,
          userId, name, role,
          transports: new Map(),
          producers: new Map(),
          consumers: new Map(),
        };
        room.peers.set(socket.id, peer);
        socket.join(sessionId);

        socket.to(sessionId).emit('peer-joined', { socketId: socket.id, userId, name, role });

        const existingPeers = Array.from(room.peers.entries())
          .filter(([id]) => id !== socket.id)
          .map(([id, p]) => ({
            socketId: id, userId: p.userId, name: p.name, role: p.role,
            producers: Array.from(p.producers.entries()).map(([pid, prod]) => ({ id: pid, kind: prod.kind })),
          }));

        cb({ routerRtpCapabilities: room.router!.rtpCapabilities, existingPeers });
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.error('join-room error:', msg);
        cb({ error: `Failed to join room: ${msg}` });
      }
    });

    socket.on('create-transport', async (data: { sessionId: string; direction: string }, cb) => {
      try {
        const room = rooms.get(data.sessionId);
        if (!room?.router) return cb({ error: 'Room not found' });
        const peer = room.peers.get(socket.id);
        if (!peer) return cb({ error: 'Peer not found — rejoin the room' });
        const transport = await createWebRtcTransport(room.router);
        peer.transports.set(transport.id, transport);
        console.log(`📦 Transport created [${data.direction}]: ${transport.id} for peer ${socket.id}`);
        cb({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
      } catch (err) {
        console.error('create-transport error:', err);
        cb({ error: 'Failed to create transport' });
      }
    });

    socket.on('connect-transport', async (data: { sessionId: string; transportId: string; dtlsParameters: any }, cb) => {
      try {
        const room = rooms.get(data.sessionId);
        const peer = room?.peers.get(socket.id);
        if (!peer) {
          console.warn(`⚠️ connect-transport: peer ${socket.id} not found in room ${data.sessionId}`);
          return cb({ error: 'Peer not found' });
        }
        const transport = peer.transports.get(data.transportId);
        if (!transport) {
          console.warn(`⚠️ connect-transport: transport ${data.transportId} not found for peer ${socket.id}. Has: [${Array.from(peer.transports.keys()).join(', ')}]`);
          return cb({ error: 'Transport not found' });
        }
        await transport.connect({ dtlsParameters: data.dtlsParameters });
        cb({ connected: true });
      } catch (err) {
        console.error('connect-transport error:', err);
        cb({ error: 'Failed to connect transport' });
      }
    });

    socket.on('produce', async (data: { sessionId: string; transportId: string; kind: string; rtpParameters: any; appData: any }, cb) => {
      try {
        const peer = rooms.get(data.sessionId)?.peers.get(socket.id);
        if (!peer) {
          console.warn(`⚠️ produce: peer ${socket.id} not found`);
          return cb({ error: 'Peer not found' });
        }
        const transport = peer.transports.get(data.transportId);
        if (!transport) {
          console.warn(`⚠️ produce: transport ${data.transportId} not found for peer ${socket.id}`);
          return cb({ error: 'Transport not found' });
        }

        const producer = await transport.produce({
          kind: data.kind as 'audio' | 'video',
          rtpParameters: data.rtpParameters,
          appData: data.appData,
        });
        peer.producers.set(producer.id, producer);

        socket.to(data.sessionId).emit('new-producer', {
          producerId: producer.id, socketId: socket.id, kind: data.kind,
        });

        producer.on('transportclose', () => {
          producer.close();
          peer.producers.delete(producer.id);
        });

        cb({ id: producer.id });
      } catch (err) {
        console.error('produce error:', err);
        cb({ error: 'Failed to produce' });
      }
    });

    socket.on('consume', async (data: { sessionId: string; transportId: string; producerId: string; rtpCapabilities: any }, cb) => {
      try {
        const room = rooms.get(data.sessionId);
        if (!room?.router) return cb({ error: 'Room not found' });
        if (!room.router.canConsume({ producerId: data.producerId, rtpCapabilities: data.rtpCapabilities })) {
          return cb({ error: 'Cannot consume' });
        }

        const peer = room.peers.get(socket.id);
        const transport = peer?.transports.get(data.transportId);
        if (!transport || !peer) return cb({ error: 'Transport not found' });

        const consumer = await transport.consume({
          producerId: data.producerId,
          rtpCapabilities: data.rtpCapabilities,
          paused: false,
        });
        peer.consumers.set(consumer.id, consumer);

        consumer.on('transportclose', () => { consumer.close(); peer.consumers.delete(consumer.id); });
        consumer.on('producerclose', () => {
          consumer.close();
          peer.consumers.delete(consumer.id);
          socket.emit('consumer-closed', { consumerId: consumer.id });
        });

        cb({ id: consumer.id, producerId: data.producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
      } catch (err) {
        console.error('consume error:', err);
        cb({ error: 'Failed to consume' });
      }
    });

    socket.on('resume-consumer', async (data: { consumerId: string; sessionId: string }, cb) => {
      try {
        const consumer = rooms.get(data.sessionId)?.peers.get(socket.id)?.consumers.get(data.consumerId);
        if (consumer) { await consumer.resume(); cb({ resumed: true }); }
        else cb({ error: 'Consumer not found' });
      } catch { cb({ error: 'Failed to resume consumer' }); }
    });

    socket.on('close-producer', async (data: { producerId: string; sessionId: string }) => {
      try {
        const peer = rooms.get(data.sessionId)?.peers.get(socket.id);
        const producer = peer?.producers.get(data.producerId);
        if (producer) {
          producer.close();
          peer?.producers.delete(data.producerId);
          socket.to(data.sessionId).emit('producer-closed', { producerId: data.producerId, socketId: socket.id });
        }
      } catch (err) { console.error('close-producer error:', err); }
    });

    // Chat relay
    socket.on('chat-message', (data: { sessionId: string; message: any }) => {
      socket.to(data.sessionId).emit('chat-message', data.message);
    });

    // Media state change relay
    socket.on('media-state-change', (data: { sessionId: string; kind: string; enabled: boolean }) => {
      socket.to(data.sessionId).emit('media-state-change', { socketId: socket.id, kind: data.kind, enabled: data.enabled });
    });

    // Video escalation — agent requests customer camera
    socket.on('request-customer-video', (data: { sessionId: string }) => {
      // Relay to all non-agent peers in the room
      const room = rooms.get(data.sessionId);
      if (room) {
        room.peers.forEach((peer, sid) => {
          if (sid !== socket.id && peer.role !== 'AGENT') {
            io.to(sid).emit('video-request');
          }
        });
      }
    });

    // Customer responds to video request — relay result back to agent
    socket.on('video-request-response', (data: { sessionId: string; accepted: boolean }) => {
      const room = rooms.get(data.sessionId);
      if (room) {
        room.peers.forEach((peer, sid) => {
          if (sid !== socket.id && peer.role === 'AGENT') {
            io.to(sid).emit(data.accepted ? 'video-request-accepted' : 'video-request-declined');
          }
        });
      }
    });

    // End session
    socket.on('end-session', (data: { sessionId: string }) => {
      io.to(data.sessionId).emit('session-ended', { endedBy: currentUserId });
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`🔌 Disconnected: ${socket.id}`);
      if (currentSessionId) {
        const room = rooms.get(currentSessionId);
        if (room) {
          const peer = room.peers.get(socket.id);
          if (peer) {
            peer.transports.forEach((t) => t.close());
            room.peers.delete(socket.id);
            socket.to(currentSessionId).emit('peer-left', { socketId: socket.id, userId: peer.userId, name: peer.name });
            if (room.peers.size === 0) {
              room.router?.close();
              rooms.delete(currentSessionId);
              console.log(`🧹 Room cleaned: ${currentSessionId}`);
            }
          }
        }
      }
    });
  });

  // Listen on all interfaces (0.0.0.0) so both laptop and mobile can connect
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`
    ╔═══════════════════════════════════════════════════════╗
    ║  🎥  mediasoup SFU + Socket.IO Server                 ║
    ║  📡  Laptop : http://localhost:${port}                    ║
    ║  📱  Mobile : http://${LAN_IP}:${port}               ║
    ║  🔌  Server-routed media — announcedIP: ${LAN_IP}   ║
    ╚═══════════════════════════════════════════════════════╝
    `);
  });
}

main().catch(console.error);
