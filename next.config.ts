import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude mediasoup (server-only) from client bundles
  serverExternalPackages: ['mediasoup', 'pg'],

  // Allow Turbopack HMR WebSocket from local network IPs (mobile/LAN access)
  allowedDevOrigins: [
    'http://192.168.1.30:3000',
    'http://192.168.1.*:3000',
    '192.168.1.30',
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
