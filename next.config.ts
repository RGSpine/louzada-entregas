import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  productionBrowserSourceMaps: false,

  experimental: {
    serverActions: {
      bodySizeLimit: "40mb",
    },
    proxyClientMaxBodySize: "40mb",
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=(), payment=(self), usb=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://js.stripe.com https://www.googletagmanager.com https://www.google-analytics.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://www.google-analytics.com https://www.googletagmanager.com",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co https://generativelanguage.googleapis.com https://api.deepseek.com https://api.perplexity.ai https://vercel.live https://api.stripe.com https://m.stripe.com https://q.stripe.com https://*.sentry.io https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com https://www.googletagmanager.com",
              "media-src 'self' blob:",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "frame-src 'self' https://vercel.live https://js.stripe.com https://hooks.stripe.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self' https://checkout.stripe.com",
              // No dev o site é http://localhost. Essa diretiva manda o navegador buscar
              // o CSS em https e o layout inteiro fica sem o visual publicado.
              ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
