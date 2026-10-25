import { serializeJsonLd } from "@/lib/seo/structured-data";

type JsonLdProps = {
  data: Record<string, unknown> | Record<string, unknown>[];
};

/**
 * Injeta JSON-LD no servidor — sem estado, sem hidratação no cliente.
 * Deve ser usado apenas em Server Components (layout/page).
 */
export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
