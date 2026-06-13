import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude mediasoup (server-only) from client bundles
  serverExternalPackages: ['mediasoup', 'pg'],

  // Allow Turbopack HMR WebSocket from ANY local network IP
  // This covers 192.168.x.x, 10.x.x.x, and localhost without hardcoding
  allowedDevOrigins: [
    // localhost variants
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    // Full 192.168.x.x subnet — covers most home/office WiFi routers
    '192.168.0.*',
    '192.168.1.*',
    '192.168.2.*',
    // 10.x.x.x subnet — covers corporate/hotspot networks
    '10.*.*.*',
    // 172.16-31.x.x subnet — covers Docker and some corporate networks
    '172.16.*.*',
  ],

  // Allow cross-origin requests to Socket.IO server
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
};

export default nextConfig;
