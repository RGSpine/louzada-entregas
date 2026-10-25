import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const dbUserSelect = {
  id: true,
  email: true,
  name: true,
  plan: true,
  isInfluencer: true,
  isBlocked: true,
  profession: true,
  councilType: true,
  councilNumber: true,
  stripeSubscriptionId: true,
  basicoCheckoutRequired: true,
  teamSetupCompletedAt: true,
  legacyFreeSunsetNoticeSentAt: true,
  legacyFreeSunsetEndsAt: true,
} as const;

/** Uma ida ao Supabase Auth por requisição, compartilhada pelo layout e pelas páginas. */
export const getRequestAuthUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
});

/** Uma leitura do usuário da conta por requisição. */
export const getRequestDbUser = cache(async () => {
  const authUser = await getRequestAuthUser();
  if (!authUser) return null;
  return prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: dbUserSelect,
  });
});
