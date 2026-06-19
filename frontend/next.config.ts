import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained bundle for Docker: node server.js
  output: 'standalone',

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
