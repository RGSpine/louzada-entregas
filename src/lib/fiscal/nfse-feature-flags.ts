/** Planos em que a emissão NFS-e será oferecida aos utilizadores. */
const NFSE_ELIGIBLE_STORED_PLANS = new Set([
  "PREMIUM",
  "CONSULTORIO",
  "CLINICA",
]);

export function isNfseEligibleStoredPlan(storedPlan: string | null | undefined): boolean {
  if (!storedPlan) return false;
  return NFSE_ELIGIBLE_STORED_PLANS.has(storedPlan);
}

/** Utilizadores podem emitir NFS-e na UI (após upgrade Notaas SaaS Pro + org token). */
export function isNfsePublicEnabled(): boolean {
  return process.env.FISCAL_NFSE_PUBLIC_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Modo legacy interno: emissão via NOTAAS_API_KEY para validação técnica
 * sem expor a funcionalidade aos utilizadores finais.
 */
export function isNfseLegacyDevEnabled(): boolean {
  return process.env.FISCAL_NFSE_LEGACY_DEV?.trim().toLowerCase() === "true";
}

export function isNfseOrgTokenConfigured(): boolean {
  const token = process.env.NOTAAS_ORG_TOKEN?.trim();
  return Boolean(token && token.startsWith("ntaas_org_"));
}

export function shouldShowNfseComingSoon(storedPlan: string | null | undefined): boolean {
  return isNfseEligibleStoredPlan(storedPlan) && !isNfsePublicEnabled();
}

export const NFSE_COMING_SOON_MESSAGE = "Função será ativada em breve";

/** Emissão permitida no servidor (legacy dev ou multi-emitente público). */
export function isNfseServerEmitAllowed(): boolean {
  if (isNfsePublicEnabled()) return true;
  return isNfseLegacyDevEnabled();
}

/** UI de emissão NFS-e visível e activa para o utilizador. */
export function isNfseUserFacingActive(storedPlan: string | null | undefined): boolean {
  return isNfseEligibleStoredPlan(storedPlan) && isNfsePublicEnabled();
}
