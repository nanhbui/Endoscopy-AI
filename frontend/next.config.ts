import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained bundle for Docker: node server.js
  output: 'standalone',

  // Allow dev HMR websocket from ngrok tunnel (Next dev rejects unknown Origin → 401)
  allowedDevOrigins: [
    'ferris-smudgy-fondue.ngrok-free.dev',
    '*.ngrok-free.dev',
    '*.ngrok-free.app',
  ],

  // Proxy /api/* to FastAPI backend (development only; Docker uses direct fetch)
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8001'}/:path*`,
      },
    ];
  },
};

export default nextConfig;
