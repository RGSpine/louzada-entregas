/** Limites do chat clínico — contexto IA, armazenamento e retenção (LGPD). */

/** Mensagens enviadas ao Gemini em cada nova pergunta (memória da conversa). */
export const CHAT_HISTORY_MESSAGES = 12;

/** Máximo de mensagens persistidas por thread profissional + paciente. */
export const CHAT_STORED_MESSAGES_MAX = 100;

/** Mensagens mais antigas que este período são removidas automaticamente. */
export const CHAT_RETENTION_MONTHS = 6;

export const CHAT_MAX_EVOLUTION_ROWS = 15;
export const CHAT_MAX_CHARS_PER_ROW = 3000;
export const CHAT_MAX_EXAM_ROWS = 12;
export const CHAT_MAX_CHARS_PER_EXAM = 2500;
export const CHAT_MAX_METRIC_ROWS = 24;
export const CHAT_TOTAL_BUDGET = 42_000;

/** Sessões de chat recentes consideradas para indicações proativas. */
export const RECOMMENDATIONS_RECENT_SESSIONS = 5;

/** Máximo de trechos de perguntas do profissional enviados ao gerador de queries. */
export const RECOMMENDATIONS_MAX_USER_SNIPPETS = 12;

/** Queries PubMed/Perplexity por refresh de indicações. */
export const RECOMMENDATIONS_MAX_QUERIES = 3;

/** Artigos exibidos no painel de indicações. */
export const RECOMMENDATIONS_MAX_ARTICLES = 8;

/** Cache on-demand (ms) — leitura após refresh manual / primeira abertura. */
export const RECOMMENDATIONS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Cache gerado pelo cron diário (ms) — cobre ~1 dia + margem. */
export const RECOMMENDATIONS_DAILY_CACHE_TTL_MS = 30 * 60 * 60 * 1000;

/** Não regenera no cron se o fingerprint do perfil for o mesmo e o cache for mais novo que isto. */
export const RECOMMENDATIONS_DAILY_MIN_REFRESH_MS = 20 * 60 * 60 * 1000;

/** Máximo de profissionais processados por execução do cron. */
export const RECOMMENDATIONS_DAILY_BATCH_SIZE = 40;

/** Concorrência de buscas PubMed/Perplexity no cron. */
export const RECOMMENDATIONS_DAILY_CONCURRENCY = 2;

/** Mínimo de tags no Perfil Clínico para entrar no cron diário. */
export const RECOMMENDATIONS_DAILY_MIN_PROFILE_TAGS = 1;
