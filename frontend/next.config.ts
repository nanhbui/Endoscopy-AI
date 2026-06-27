import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained bundle for Docker: node server.js
  output: 'standalone',

  experimental: {
    // Upload videos through the same-origin /api proxy. Next defaults to 10MB,
    // which cuts larger mp4 uploads before FastAPI can finish reading them.
    proxyClientMaxBodySize: '2gb',
  },

  // Allow dev requests from the public tunnel host (Next dev blocks cross-origin
  // /_next/* + HMR ws from unknown Origin → page renders but client JS is dead).
  // server4 is exposed via Tailscale Funnel (server4.tail145f3.ts.net).
  allowedDevOrigins: [
    'server4.tail145f3.ts.net',
    '*.ts.net',
    'ferris-smudgy-fondue.ngrok-free.dev',
    '*.ngrok-free.dev',
    '*.ngrok-free.app',
  ],

  // Keep backend private in the Docker network. The browser talks only to the
  // frontend origin; Next forwards API and WebSocket paths to FastAPI.
  async rewrites() {
    const backendUrl = process.env.BACKEND_INTERNAL_URL ?? 'http://backend:8001';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
      {
        source: '/ws/:path*',
        destination: `${backendUrl}/ws/:path*`,
      },
    ];
  },
};

export default nextConfig;
