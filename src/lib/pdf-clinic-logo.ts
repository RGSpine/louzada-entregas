export type PdfLogoFormat = "PNG" | "JPEG" | "WEBP";

export type PdfLogoImage = {
  data: string;
  format: PdfLogoFormat;
};

export function detectPdfLogoFormat(
  mimeOrUrl: string,
  fallback: PdfLogoFormat = "PNG",
): PdfLogoFormat {
  const raw = mimeOrUrl.toLowerCase();
  if (raw.includes("jpeg") || raw.includes("jpg")) return "JPEG";
  if (raw.includes("webp")) return "WEBP";
  if (raw.includes("png")) return "PNG";
  return fallback;
}

/** Extrai base64 + formato de um data URL de imagem. */
export function parseDataUrlLogo(dataUrl: string): PdfLogoImage | null {
  if (!dataUrl.startsWith("data:image")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1).trim();
  if (!data) return null;
  return { data, format: detectPdfLogoFormat(header) };
}

/**
 * Carrega a logo do profissional para jsPDF (data URL ou URL pública do Storage).
 * Falha silenciosa: o PDF segue sem logo.
 */
export async function resolveClinicLogoForPdf(
  source: string | null | undefined,
): Promise<PdfLogoImage | null> {
  const value = source?.trim();
  if (!value) return null;

  const fromData = parseDataUrlLogo(value);
  if (fromData) return fromData;

  if (!/^https?:\/\//i.test(value)) return null;

  try {
    const res = await fetch(value, { cache: "no-store" });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 32) return null;
    const contentType = res.headers.get("content-type") ?? "";
    return {
      data: buffer.toString("base64"),
      format: detectPdfLogoFormat(`${contentType} ${value}`),
    };
  } catch {
    return null;
  }
}
