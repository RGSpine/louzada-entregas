/** Sugestão de profissional mostrada no chat. Sem Prisma. */
export type HealthChatProfessionalSuggestion = {
  profileId: string;
  name: string;
  profession: string | null;
  specialty: string | null;
  headline: string | null;
  city: string | null;
  state: string | null;
  nextSlotId: string | null;
  nextSlotAt: string | null;
  effectivePrice: number | null;
  reason: string;
};

export type HealthChatCitationView = {
  id: string;
  title: string;
  url: string;
  source: string;
  snippet?: string | null;
};

export type HealthChatMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: HealthChatCitationView[];
  evidenceSearchUsed?: boolean;
  /** Só true quando o paciente pediu fontes/referências. */
  showCitations?: boolean;
  professionalSuggestions?: HealthChatProfessionalSuggestion[];
  conclusions?: string[];
  urgency?: "routine" | "soon" | "urgent_care_advice";
};
