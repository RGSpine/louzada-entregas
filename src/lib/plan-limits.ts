/**
 * Limites e permissões por plano (Básico, Profissional, Premium).
 * Usado para validar criação de evoluções, pacientes e uso de áudio/imagens.
 */

import { PENDING_CHECKOUT_LIMITS, isPendingCheckoutPlan } from "@/lib/basico-plan";
import { normalizePlanTier } from "@/lib/plan-tier";
import { planSupportsIntraUsers } from "@/lib/intra-user/constants";

export type PlanType = "BASICO" | "PROFISSIONAL" | "PREMIUM";

/** E-mail do dono do SaaS: acesso total (limites ignorados) e painel /admin. */
export const ADMIN_EMAIL = "robertoguanaes@gmail.com";

/** Dono da plataforma (comparado sem case). */
export function isPlatformOwnerEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

/** Acesso ao painel admin e APIs administrativas: role ADMIN no banco OU e-mail do dono. */
export function hasAdminRole(role: string | null | undefined, email: string | null | undefined): boolean {
  if (isPlatformOwnerEmail(email)) return true;
  return role === "ADMIN";
}

/**
 * E-mail para checagem de dono/admin: prioriza o da sessão Supabase; fallback no registro Prisma
 * (em deploy o JWT às vezes não inclui `email` dependendo da versão do cliente / cookies).
 */
export function resolveSessionEmail(
  authEmail: string | null | undefined,
  dbEmail: string | null | undefined
): string | null {
  const fromAuth = typeof authEmail === "string" ? authEmail.trim() : "";
  if (fromAuth) return fromAuth;
  const fromDb = typeof dbEmail === "string" ? dbEmail.trim() : "";
  return fromDb || null;
}

export interface PlanLimits {
  maxEvolutions: number;
  maxPatients: number;
  maxAudioMinutes: number;
  canAnalyzeImages: boolean;
}

/** Segundos máximos de áudio por gravação (a partir do limite em minutos). */
export function maxAudioSecondsFromLimit(maxAudioMinutes: number): number {
  if (!Number.isFinite(maxAudioMinutes)) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(maxAudioMinutes * 60));
}

/** Rótulo curto para cards (ex.: "30 seg", "4 min"). */
export function formatAudioLimitLabel(maxAudioMinutes: number): string {
  if (!Number.isFinite(maxAudioMinutes)) return "Ilimitado";
  const sec = Math.round(maxAudioMinutes * 60);
  if (sec < 60) return `${sec} seg`;
  return `${Math.floor(maxAudioMinutes)} min`;
}

/** Frase para toasts e mensagens (ex.: "30 segundos", "4 minutos"). */
export function formatAudioLimitPhrase(maxAudioMinutes: number): string {
  if (!Number.isFinite(maxAudioMinutes)) return "tempo ilimitado";
  const sec = Math.round(maxAudioMinutes * 60);
  if (sec < 60) return sec === 1 ? "1 segundo" : `${sec} segundos`;
  const m = Math.floor(maxAudioMinutes);
  return m === 1 ? "1 minuto" : `${m} minutos`;
}

export function formatAudioLimitPhraseFromSeconds(maxAudioSeconds: number): string {
  return formatAudioLimitPhrase(maxAudioSeconds / 60);
}

const LIMITS: Record<PlanType, PlanLimits> = {
  BASICO: {
    maxEvolutions: 20,
    maxPatients: 10,
    maxAudioMinutes: 2,
    canAnalyzeImages: false,
  },
  PROFISSIONAL: {
    maxEvolutions: 80,
    maxPatients: 100,
    maxAudioMinutes: 3,
    canAnalyzeImages: false,
  },
  PREMIUM: {
    maxEvolutions: Infinity,
    maxPatients: Infinity,
    maxAudioMinutes: 6,
    canAnalyzeImages: true,
  },
};

/** Limites máximos para Super Admin (tudo liberado). */
const ADMIN_LIMITS: PlanLimits = {
  maxEvolutions: Infinity,
  maxPatients: Infinity,
  maxAudioMinutes: Infinity,
  canAnalyzeImages: true,
};


/**
 * Plano armazenado + flag influenciador → tier usado em limites (PRO sem Stripe).
 * Incomplete/null NÃO é Básico — retorna BASICO só como tipagem morta; callers
 * devem checar isPendingCheckoutPlan / needsBasicoCheckout antes.
 */
export function effectivePlanForFeatures(
  storedPlan: string | null | undefined,
  isInfluencer: boolean,
): PlanType {
  if (isInfluencer) return "PREMIUM";
  if (isPendingCheckoutPlan(storedPlan)) return "BASICO"; // tipagem; gates usam PENDING_CHECKOUT_LIMITS
  const tier = normalizePlanTier(storedPlan);
  if (!tier) return "BASICO"; // desconhecido sem Stripe já foi filtrado acima
  if (tier === "CONSULTORIO" || tier === "CLINICA") return "PREMIUM";
  if (tier === "PROFISSIONAL") return "PROFISSIONAL";
  if (tier === "PREMIUM") return "PREMIUM";
  return "BASICO";
}

/**
 * Retorna os limites do plano. Planos desconhecidos são tratados como Básico.
 * Se email === ADMIN_EMAIL, retorna limites totais (Super Admin).
 * Influenciadores recebem os mesmos limites do PRO.
 */
export function getPlanLimits(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): PlanLimits {
  if (isPlatformOwnerEmail(email)) return { ...ADMIN_LIMITS };
  if (isInfluencer) return { ...LIMITS.PREMIUM };
  // Cadastro sem checkout: zero acesso (não herdar limites do Básico legado).
  if (isPendingCheckoutPlan(userPlan)) {
    return { ...PENDING_CHECKOUT_LIMITS };
  }
  const plan = effectivePlanForFeatures(userPlan, !!isInfluencer);
  return { ...LIMITS[plan] };
}

/**
 * Verifica se o usuário pode criar uma nova evolução (dentro do limite mensal).
 * Super Admin sempre pode.
 */
export function canCreateEvolution(
  userPlan: string | null | undefined,
  currentCount: number,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  if (isPlatformOwnerEmail(email)) return true;
  const limits = getPlanLimits(userPlan, email, isInfluencer);
  return currentCount < limits.maxEvolutions;
}

/**
 * Verifica se o usuário pode adicionar um novo paciente.
 * Super Admin sempre pode.
 */
export function canAddPatient(
  userPlan: string | null | undefined,
  currentCount: number,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  if (isPlatformOwnerEmail(email)) return true;
  const limits = getPlanLimits(userPlan, email, isInfluencer);
  return currentCount < limits.maxPatients;
}

/**
 * Verifica se o usuário pode usar análise de imagens (exames).
 * Super Admin sempre pode.
 */
export function canAnalyzeImages(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  if (isPlatformOwnerEmail(email)) return true;
  const limits = getPlanLimits(userPlan, email, isInfluencer);
  return limits.canAnalyzeImages;
}

/**
 * Visão (imagem/PDF) no fluxo com `mergeMode`: Profissional ou Premium; Básico não.
 */
export function canUseVisionInDocumentMerge(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  return isProfissionalOrAbove(userPlan, email, isInfluencer);
}

/**
 * Verifica se o plano é Profissional ou superior (Profissional, Premium).
 * Features como detecção de homônimos, metas e compartilhamento gamificado
 * requerem pelo menos Profissional. Super Admin sempre tem acesso.
 */
export function isProfissionalOrAbove(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean,
): boolean {
  if (isPlatformOwnerEmail(email)) return true;
  if (isInfluencer) return true;
  // Pré-pagamento: sem features pagas.
  if (isPendingCheckoutPlan(userPlan)) return false;
  const tier = effectivePlanForFeatures(userPlan, !!isInfluencer);
  return tier === "PROFISSIONAL" || tier === "PREMIUM";
}

/** @deprecated Alias legado — use isProfissionalOrAbove */
export const isStarterOrAbove = isProfissionalOrAbove;

function isPremiumFeatureTier(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean,
): boolean {
  if (isPlatformOwnerEmail(email)) return true;
  if (isInfluencer) return true;
  if (isPendingCheckoutPlan(userPlan)) return false;
  return effectivePlanForFeatures(userPlan, !!isInfluencer) === "PREMIUM";
}

/**
 * Pasta de Exames no perfil do paciente: apenas Premium (Super Admin ignora).
 */
export function canUsePatientExamFolder(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  if (isPlatformOwnerEmail(email)) return true;
  if (isInfluencer) return true;
  return isPremiumFeatureTier(userPlan, email, isInfluencer);
}

/**
 * Agendar consultas por áudio ou foto na agenda: Profissional ou superior.
 */
export function canUseAgendaIntake(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  return isProfissionalOrAbove(userPlan, email, isInfluencer);
}

/**
 * Cores de confirmação na agenda (amarelo/verde): Profissional ou superior.
 */
export function canUseAgendaConfirmationColors(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  return isProfissionalOrAbove(userPlan, email, isInfluencer);
}

/**
 * Projeção financeira na agenda (valores da semana): Profissional ou superior.
 */
export function canUseAgendaFinanceProjection(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  return isProfissionalOrAbove(userPlan, email, isInfluencer);
}

/**
 * Relatórios curtos da agenda (voz/texto): apenas Premium.
 */
export function canUseAgendaReports(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  return isPremiumFeatureTier(userPlan, email, isInfluencer);
}

/** @deprecated Use canUseAgendaReports — mantido para compatibilidade. */
export function canUseVoiceAgenda(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  return canUseAgendaReports(userPlan, email, isInfluencer);
}

/**
 * Módulo Consultório financeiro (/dashboard/finances): Premium, Consultório ou Clínica.
 */
export function canUseOfficeFinance(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean,
): boolean {
  return isPremiumFeatureTier(userPlan, email, isInfluencer);
}

/**
 * Espaços de Serviços (salas/unidades): **somente** Consultório e Clínica.
 * Não confundir com `canUseOfficeFinance` (Premium individual também passa).
 */
export function canUseServiceSpaces(
  userPlan: string | null | undefined,
  _email?: string | null,
  isInfluencer?: boolean,
): boolean {
  if (isInfluencer) return false;
  const tier = normalizePlanTier(userPlan);
  if (!tier) return false;
  return planSupportsIntraUsers(tier);
}

/**
 * Agente financeiro (texto/áudio/comprovante com IA): apenas Premium+.
 */
export function canUseFinanceAssistant(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  return canUseOfficeFinance(userPlan, email, isInfluencer);
}

/**
 * Chat clínico por paciente (contexto das evoluções + IA): apenas Premium.
 */
export function canUsePatientClinicalChat(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  return isPremiumFeatureTier(userPlan, email, isInfluencer);
}

/**
 * Suporte prioritário (WhatsApp direto): apenas Premium.
 */
export function canUsePrioritySupport(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  return isPremiumFeatureTier(userPlan, email, isInfluencer);
}

export const YIELD_MANAGEMENT_PLAN_ERROR =
  "Gestão Inteligente está disponível nos planos Premium, Consultório e Clínica.";

/**
 * Marketplace / yield (Gestão Inteligente): Premium, Consultório e Clínica.
 */
export function canUseYieldManagement(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean,
): boolean {
  return isPremiumFeatureTier(userPlan, email, isInfluencer);
}

/** Aba Exames/Documentos (listar e ver PDFs gerados): todos os planos. */
export function canAccessPatientDocumentsTab(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  if (isPlatformOwnerEmail(email)) return true;
  if (isInfluencer) return true;
  return true;
}

/** Limite mensal de documentos gerados por IA no plano Básico (mês civil UTC). */
export const BASICO_AI_DOCUMENTS_PER_MONTH = 5;

/** @deprecated Alias legado — use BASICO_AI_DOCUMENTS_PER_MONTH */
export const FREE_AI_DOCUMENTS_PER_MONTH = BASICO_AI_DOCUMENTS_PER_MONTH;

/**
 * Cotas mensais de importação de histórico de outra plataforma (lote = 1 import).
 * Distinto do limite de evoluções novas. Premium / Consultório / Clínica = ilimitado.
 */
export const HISTORY_IMPORTS_PER_MONTH: Record<PlanType, number> = {
  BASICO: 5,
  PROFISSIONAL: 20,
  PREMIUM: Infinity,
};

/** Máximo de ficheiros por lote de importação (saudável p/ IA + upload). */
export const MAX_HISTORY_IMPORT_FILES = 12;

/** Tamanho máximo por ficheiro no lote (bytes) — alinhado à pasta de exames. */
export const MAX_HISTORY_IMPORT_FILE_BYTES = 8 * 1024 * 1024;

/** Teto total do lote (bytes). */
export const MAX_HISTORY_IMPORT_TOTAL_BYTES = 48 * 1024 * 1024;

/** Limite mensal efetivo de importações de histórico para o plano. */
export function getMaxHistoryImportsPerMonth(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean,
): number {
  if (isPlatformOwnerEmail(email)) return Infinity;
  if (isInfluencer) return Infinity;
  if (isPendingCheckoutPlan(userPlan)) return 0;
  const plan = effectivePlanForFeatures(userPlan, !!isInfluencer);
  return HISTORY_IMPORTS_PER_MONTH[plan];
}

/**
 * Verifica se o utilizador ainda pode importar histórico neste mês.
 * Super Admin / influenciador sempre pode.
 */
export function canImportPatientHistory(
  userPlan: string | null | undefined,
  currentImportCount: number,
  email?: string | null,
  isInfluencer?: boolean,
): boolean {
  if (isPlatformOwnerEmail(email)) return true;
  if (isInfluencer) return true;
  const max = getMaxHistoryImportsPerMonth(userPlan, email, isInfluencer);
  if (!Number.isFinite(max)) return true;
  return currentImportCount < max;
}

/**
 * Buscas de evidência externa (PubMed/Perplexity) no chat clínico Premium — mês civil UTC.
 * Cada resposta do assistente que consultou literatura conta 1 (não cada chamada Perplexity).
 */
export const CLINICAL_CHAT_EVIDENCE_SEARCHES_PER_MONTH = 40;

/** Limite efetivo (env `CLINICAL_CHAT_EVIDENCE_MONTHLY_LIMIT` sobrescreve o padrão). */
export function getClinicalChatEvidenceMonthlyLimit(): number {
  const raw = process.env.CLINICAL_CHAT_EVIDENCE_MONTHLY_LIMIT?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return CLINICAL_CHAT_EVIDENCE_SEARCHES_PER_MONTH;
}

/** Dono da plataforma e influenciadores: sem teto de buscas de evidência. */
export function isClinicalChatEvidenceQuotaUnlimited(
  email?: string | null,
  isInfluencer?: boolean,
): boolean {
  if (isPlatformOwnerEmail(email)) return true;
  if (isInfluencer) return true;
  return false;
}

export function isBasicoPlanForDocumentQuota(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean
): boolean {
  if (isPlatformOwnerEmail(email)) return false;
  if (isInfluencer) return false;
  return effectivePlanForFeatures(userPlan, !!isInfluencer) === "BASICO";
}

/** @deprecated Alias legado — use isBasicoPlanForDocumentQuota */
export const isFreePlanForDocumentQuota = isBasicoPlanForDocumentQuota;
