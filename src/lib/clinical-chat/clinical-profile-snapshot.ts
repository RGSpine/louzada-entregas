import { prisma } from "@/lib/prisma";
import {
  aggregateClinicalProfile,
  type ClinicalProfileSnapshot,
  type ClinicalProfileTag,
} from "@/lib/clinical-profile-tags";

export type { ClinicalProfileSnapshot, ClinicalProfileTag };

/** Perfil clínico (top tags guarda-chuva) — mesma lógica de Estatísticas → Perfil Clínico. */
export async function getClinicalProfileSnapshot(
  userId: string,
): Promise<ClinicalProfileSnapshot> {
  const evolutions = await prisma.evolution.findMany({
    where: { patient: { userId } },
    select: {
      tags: true,
      clinicalMeta: true,
      content: true,
      date: true,
    },
  });

  return aggregateClinicalProfile(evolutions);
}
