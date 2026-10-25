/**
 * Ponto de entrada da busca de evidência no chat clínico.
 * Implementação em evidence-providers.ts e módulos por provedor.
 */
export {
  getEvidenceProviderMode,
  isClinicalEvidenceSearchAvailable,
  isConsensusConfigured,
  isPerplexityConfigured,
  isPubMedAvailable,
  getActiveEvidenceProviderLabels,
  searchClinicalEvidence,
  type EvidenceProviderMode,
} from "@/lib/clinical-chat/evidence-providers";
