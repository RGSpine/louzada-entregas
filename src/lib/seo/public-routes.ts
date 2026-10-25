import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/site-config";

type SitemapEntry = MetadataRoute.Sitemap[number];

/** Rotas públicas indexáveis — exclui dashboard, admin, APIs e auth efêmera. */
export const PUBLIC_SITEMAP_ROUTES: SitemapEntry[] = [
  { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
  { url: `${SITE_URL}/profissional`, changeFrequency: "weekly", priority: 0.95 },
  { url: `${SITE_URL}/paciente`, changeFrequency: "weekly", priority: 0.95 },
  { url: `${SITE_URL}/vitrine`, changeFrequency: "weekly", priority: 0.85 },
  { url: `${SITE_URL}/buscar`, changeFrequency: "weekly", priority: 0.75 },
  { url: `${SITE_URL}/cadastro-paciente`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/planos`, changeFrequency: "weekly", priority: 0.9 },
  { url: `${SITE_URL}/register`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${SITE_URL}/como-baixar-app`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/plataforma-personalizada`, changeFrequency: "monthly", priority: 0.6 },
  { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
  { url: `${SITE_URL}/privacidade`, changeFrequency: "yearly", priority: 0.3 },
];
