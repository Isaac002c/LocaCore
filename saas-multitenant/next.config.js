/** @type {import('next').NextConfig} */

// Em desenvolvimento: proxy para localhost:5000
// Em produção (Vercel): defina BACKEND_URL com o domínio da API (ex.: https://api.seu-dominio.com).
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

// Origem extra liberada no connect-src do CSP. As chamadas do app usam /api
// relativo (proxied → mesma origem), então 'self' basta; esta variável só é
// necessária se o frontend chamar a API cross-origin. Parametrizável por env,
// sem domínio fixo de terceiros.
const API_PUBLIC_ORIGIN = process.env.API_PUBLIC_ORIGIN || '';

const nextConfig = {
  reactStrictMode: true,

  async rewrites() {
    return [
      // Proxy todas as chamadas /api/* e /auth/* para o backend
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
      {
        source: '/auth/:path*',
        destination: `${BACKEND_URL}/auth/:path*`,
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              `connect-src 'self'${API_PUBLIC_ORIGIN ? ` ${API_PUBLIC_ORIGIN}` : ''}`,
              "frame-ancestors 'none'",
              "object-src 'none'",
            ].join('; '),
          },
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;