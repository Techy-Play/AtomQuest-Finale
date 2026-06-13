import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude mediasoup (server-only) from client bundles
  serverExternalPackages: ['mediasoup', 'pg'],
  
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
