import type { ClinicalProfileSnapshot } from "@/lib/clinical-chat/clinical-profile-snapshot";

/** Assinatura estável do Perfil Clínico para invalidar Indicações quando o caso muda. */
export function clinicalProfileFingerprint(profile: ClinicalProfileSnapshot): string {
  const tags = profile.topTags
    .map((t) => `${t.tag.toLowerCase()}:${t.count}`)
    .sort()
    .join(",");
  return [
    `tags=${tags}`,
    `focus=${(profile.mostFrequentTag ?? "").toLowerCase()}`,
    `month=${profile.monthTagCount}`,
    `total=${profile.totalTags}`,
  ].join("|");
}
