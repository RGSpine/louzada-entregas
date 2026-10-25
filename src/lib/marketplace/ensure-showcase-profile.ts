import { prisma } from "@/lib/prisma";
import { professionPublicLabel } from "@/lib/profession-options";
import { canUseYieldManagement } from "@/lib/plan-limits";
import { isShowcaseEligibleProfession } from "@/lib/marketplace/showcase-eligibility";

/**
 * Cria o card básico da vitrine para Premium, Consultório e Clínica
 * quando o perfil público ainda não existe. Não religa quem desmarcou a publicação.
 */
export async function ensureShowcaseProfileForUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      plan: true,
      isInfluencer: true,
      isBlocked: true,
      profession: true,
      avatarUrl: true,
      image: true,
      professionalProfile: { select: { id: true } },
    },
  });
  if (!user || user.isBlocked || user.professionalProfile) return;
  if (!canUseYieldManagement(user.plan, user.email, user.isInfluencer)) return;
  if (!isShowcaseEligibleProfession(user.profession)) return;

  try {
    await prisma.professionalProfile.create({
      data: {
        userId: user.id,
        showcaseApproved: true,
        publicPhotoUrl: user.avatarUrl || user.image,
        publicHeadline: professionPublicLabel(user.profession),
      },
    });
  } catch {
    // Outra requisição pode ter criado o perfil no mesmo instante.
  }
}
