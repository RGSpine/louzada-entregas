import type { User as SupabaseUser } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { isPlatformOwnerEmail } from "@/lib/plan-limits";
import {
  googleAvatarUrl,
  googleDisplayName,
  isProfessionalProfileComplete,
} from "@/lib/auth/google-profile";

export type SyncGoogleAuthUserResult = {
  profileComplete: boolean;
  isNewUser: boolean;
  dbUserId: string;
};

/**
 * Garante registro Prisma após login/cadastro Google (Supabase Auth).
 * Nome e e-mail bastam. Profissão, conselho e logo não entram no cadastro.
 */
export async function syncGoogleAuthUser(
  authUser: SupabaseUser,
): Promise<SyncGoogleAuthUserResult> {
  const email = authUser.email?.trim().toLowerCase();
  if (!email) {
    throw new Error("Conta Google sem e-mail.");
  }

  const name =
    googleDisplayName(authUser.user_metadata) ??
    email.split("@")[0] ??
    "Usuário";
  const image = googleAvatarUrl(authUser.user_metadata);

  let dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email }],
    },
    select: {
      id: true,
      authUserId: true,
      email: true,
      name: true,
      image: true,
      profession: true,
      councilType: true,
      councilNumber: true,
    },
  });

  const isNewUser = !dbUser;

  if (!dbUser) {
    const created = await prisma.user.create({
      data: {
        id: authUser.id,
        authUserId: authUser.id,
        email,
        name,
        image,
        plan: "CLINICA",
        accountStatus: "ACTIVE",
        basicoCheckoutRequired: false,
      },
      select: {
        id: true,
        authUserId: true,
        email: true,
        name: true,
        image: true,
        profession: true,
        councilType: true,
        councilNumber: true,
      },
    });
    dbUser = created;
    const { ensureCrmProfile } = await import("@/lib/crm/sync-account");
    await ensureCrmProfile(created.id);
  } else {
    const updates: {
      authUserId?: string;
      name?: string;
      image?: string | null;
    } = {};

    if (!dbUser.authUserId) updates.authUserId = authUser.id;
    if (!dbUser.name?.trim()) updates.name = name;
    if (!dbUser.image && image) updates.image = image;

    if (Object.keys(updates).length > 0) {
      dbUser = await prisma.user.update({
        where: { id: dbUser.id },
        data: updates,
        select: {
          id: true,
          authUserId: true,
          email: true,
          name: true,
          image: true,
          profession: true,
          councilType: true,
          councilNumber: true,
        },
      });
    }

    if (dbUser.id !== authUser.id) {
      try {
        await prisma.user.update({
          where: { id: dbUser.id },
          data: { id: authUser.id, authUserId: authUser.id },
        });
        dbUser = { ...dbUser, id: authUser.id, authUserId: authUser.id };
      } catch {
        // IDs divergentes legados — não bloqueia o login
      }
    }
  }

  if (isPlatformOwnerEmail(email)) {
    try {
      await prisma.user.updateMany({
        where: {
          OR: [{ email: { equals: email, mode: "insensitive" } }, { id: authUser.id }],
        },
        data: { role: "ADMIN" },
      });
    } catch {
      // não bloqueia
    }
  }

  return {
    profileComplete: isProfessionalProfileComplete(dbUser),
    isNewUser,
    dbUserId: dbUser.id,
  };
}
