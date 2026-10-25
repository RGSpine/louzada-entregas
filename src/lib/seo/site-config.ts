/** Constantes públicas de marca e URL — fonte única para metadata e JSON-LD. */
export const SITE_URL = "http://localhost:3000" as const;

export const SITE_NAME = "Louzada Entregas" as const;

export const SITE_TAGLINE = "Coletas, entregas e financeiro" as const;

export const SITE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}` as const;

export const ORGANIZATION_NAME = "Louzada Entregas" as const;

export const SITE_DESCRIPTION =
  "Coletas e entregas de prótese, clientes do laboratório e financeiro.";

export const SITE_KEYWORDS = [
  "agenda",
  "documentos",
  "transcrição",
  "financeiro",
  "equipe",
] as const;

export const CONTACT_EMAILS = {
  geral: "contato@louzada.local",
  privacidade: "privacidade@louzada.local",
  suporte: "suporte@louzada.local",
} as const;
