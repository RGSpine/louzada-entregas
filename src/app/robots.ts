import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/site-config";

/**
 * robots.txt — áreas autenticadas/API bloqueadas; bots de busca e GEO/IA permitidos.
 * Sitemap absoluto (obrigatório em propriedade Domínio no GSC).
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = [
    "/dashboard/",
    "/admin/",
    "/api/",
    "/auth/",
    "/sentry-test",
    "/register/complete",
    "/mapa-saude",
    "/reservar",
  ];

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow,
      },
      // GEO / AEO — não bloquear crawlers de IA de busca e citação (políticas 2026).
      { userAgent: "GPTBot", allow: "/", disallow },
      { userAgent: "OAI-SearchBot", allow: "/", disallow },
      { userAgent: "ChatGPT-User", allow: "/", disallow },
      { userAgent: "ClaudeBot", allow: "/", disallow },
      { userAgent: "anthropic-ai", allow: "/", disallow },
      { userAgent: "PerplexityBot", allow: "/", disallow },
      { userAgent: "Google-Extended", allow: "/", disallow },
      { userAgent: "GoogleOther", allow: "/", disallow },
      { userAgent: "Googlebot", allow: "/", disallow },
      { userAgent: "Claude-SearchBot", allow: "/", disallow },
      { userAgent: "Bingbot", allow: "/", disallow },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
