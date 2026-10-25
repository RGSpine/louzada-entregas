import type { MetadataRoute } from "next";
import { PUBLIC_SITEMAP_ROUTES } from "@/lib/seo/public-routes";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_SITEMAP_ROUTES.map((route) => ({
    ...route,
    lastModified,
  }));
}
