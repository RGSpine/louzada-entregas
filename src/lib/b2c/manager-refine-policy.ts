/**
 * Política pura: quando o rascunho Flash do health-manager merece refine DeepSeek.
 */

export type ManagerRefineDraft = {
  urgency: "routine" | "soon" | "urgent_care_advice";
  specialtyHints: string[];
  symptoms: string[];
  suggestedProfileIds: string[];
};

/** Urgência ou match de vitrine incerto (sem checar API key). */
export function managerDraftNeedsDeepSeekRefine(
  draft: ManagerRefineDraft,
  includeCatalog: boolean,
): boolean {
  if (draft.urgency === "urgent_care_advice" || draft.urgency === "soon") {
    return true;
  }
  if (!includeCatalog) return false;
  const hasHints = draft.specialtyHints.length > 0 || draft.symptoms.length > 0;
  const noIds = draft.suggestedProfileIds.length === 0;
  return hasHints && noIds;
}
