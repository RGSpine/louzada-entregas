"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { enforceRateLimit, PROFILE_LOGO_RATE_LIMIT, PROFILE_DELIVERY_PREFS_RATE_LIMIT } from "@/lib/rate-limit";
import { cancelStripeBillingForUser } from "@/lib/stripe-billing-cancel";
import { scheduleMarketplaceSlotSync } from "@/lib/marketplace/marketplace-sync";
import { getIntraUserContext } from "@/lib/intra-user/context";

export interface ProfileData {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  profession: string | null;
  councilType: string | null;
  councilNumber: string | null;
  officeAddress: string | null;
  clinicLogoUrl: string | null;
  /** Baixar PDF automaticamente ao gerar evolução (default: true). */
  autoDownloadNewEvolution: boolean;
  /** Enviar PDF por e-mail ao gerar evolução (default: true). */
  emailNewEvolution: boolean;
}

export interface GetProfileResult {
  success: boolean;
  profile?: ProfileData;
  isPrincipalAdmin?: boolean;
  error?: string;
}

export interface UpdateProfileResult {
  success: boolean;
  error?: string;
}

export interface ClinicLogoResult {
  success: boolean;
  error?: string;
  clinicLogoUrl?: string | null;
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const logoFileMetaSchema = z.object({
  size: z.number().int().positive().max(LOGO_MAX_BYTES),
  type: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
});

export interface DeleteAccountResult {
  success: boolean;
  error?: string;
}

// Obter dados do perfil do usuário logado
export async function getMyProfile(): Promise<GetProfileResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    // Log para debug em produção
    if (process.env.NODE_ENV === 'production') {
      console.log("[getMyProfile] Auth check:", { 
        hasUser: !!authUser, 
        email: authUser?.email || 'null',
        error: authError?.message || 'none' 
      });
    }
    
    if (authError || !authUser?.email) {
      console.warn("[getMyProfile] Autenticação falhou:", authError?.message || "Sem email");
      return { success: false, error: "Usuário não autenticado" };
    }

    const user = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        profession: true,
        councilType: true,
        councilNumber: true,
        officeAddress: true,
        clinicLogoUrl: true,
      },
    });

    if (!user) {
      return { success: false, error: "Usuário não encontrado" };
    }

    // Preferências de entrega: select separado para não derrubar o perfil se o client estiver desatualizado.
    let autoDownloadNewEvolution = true;
    let emailNewEvolution = true;
    try {
      const prefs = await prisma.user.findUnique({
        where: { email: authUser.email },
        select: {
          autoDownloadNewEvolution: true,
          emailNewEvolution: true,
        },
      });
      if (prefs) {
        autoDownloadNewEvolution = prefs.autoDownloadNewEvolution;
        emailNewEvolution = prefs.emailNewEvolution;
      }
    } catch (prefsError) {
      console.warn(
        "[getMyProfile] Preferências de entrega indisponíveis; usando defaults.",
        prefsError instanceof Error ? prefsError.message : prefsError,
      );
    }

    const ctx = await getIntraUserContext();

    return {
      success: true,
      isPrincipalAdmin: ctx?.activeIntraUser?.isOwner === true,
      profile: {
        ...user,
        autoDownloadNewEvolution,
        emailNewEvolution,
      },
    };
  } catch (error) {
    console.error("Erro ao obter perfil:", error);
    return { success: false, error: "Erro ao carregar perfil" };
  }
}

// Atualizar dados do perfil
export async function updateMyProfile(data: { name: string }): Promise<UpdateProfileResult> {
  try {
    const name = data.name.trim();
    if (name.length < 2) {
      return { success: false, error: "Informe o nome." };
    }

    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    const ctx = await getIntraUserContext();
    if (!ctx?.activeIntraUser?.isOwner) {
      return { success: false, error: "Só o administrador principal altera os dados da conta." };
    }

    const updated = await prisma.user.update({
      where: { email: authUser.email },
      data: { name: name.slice(0, 120) },
      select: { id: true },
    });

    scheduleMarketplaceSlotSync(updated.id);
    revalidatePath("/dashboard/profile");
    return { success: true };
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    return { success: false, error: "Erro ao atualizar perfil" };
  }
}

const evolutionDeliveryPrefsSchema = z.object({
  autoDownloadNewEvolution: z.boolean(),
  emailNewEvolution: z.boolean(),
});

/** Preferências de entrega do PDF (download no dispositivo / e-mail). Independentes entre si. */
export async function updateEvolutionDeliveryPreferences(data: {
  autoDownloadNewEvolution: boolean;
  emailNewEvolution: boolean;
}): Promise<UpdateProfileResult> {
  try {
    const parsed = evolutionDeliveryPrefsSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: "Dados inválidos" };
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    const rate = await enforceRateLimit(
      `profile-delivery-prefs:${authUser.email.toLowerCase()}`,
      PROFILE_DELIVERY_PREFS_RATE_LIMIT,
    );
    if (!rate.allowed) {
      return {
        success: false,
        error: `Muitas alterações. Tente em ${rate.resetIn}s.`,
      };
    }

    await prisma.user.update({
      where: { email: authUser.email },
      data: {
        autoDownloadNewEvolution: parsed.data.autoDownloadNewEvolution,
        emailNewEvolution: parsed.data.emailNewEvolution,
      },
    });

    revalidatePath("/dashboard/profile");
    revalidatePath("/dashboard/new-evolution");
    return { success: true };
  } catch (error) {
    console.error("Erro ao atualizar preferências de entrega:", error);
    return { success: false, error: "Erro ao salvar preferências" };
  }
}

/** Upload ou substituição da logo do profissional (Storage `images/logos/…` + `User.clinicLogoUrl`). */
export async function uploadMyClinicLogo(formData: FormData): Promise<ClinicLogoResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    const rate = await enforceRateLimit(
      `profile-logo:${authUser.email.toLowerCase()}`,
      PROFILE_LOGO_RATE_LIMIT
    );
    if (!rate.allowed) {
      return {
        success: false,
        error: `Muitas alterações de logo. Tente em ${rate.resetIn}s.`,
      };
    }

    const file = formData.get("clinicLogo");
    if (!file || !(file instanceof File) || file.size === 0) {
      return { success: false, error: "Selecione um arquivo de imagem." };
    }

    const metaParsed = logoFileMetaSchema.safeParse({
      size: file.size,
      type: file.type,
    });
    if (!metaParsed.success) {
      return {
        success: false,
        error: "Arquivo inválido: use PNG, JPEG, WebP ou GIF de até 2 MB.",
      };
    }

    const dbUser = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { id: true },
    });
    if (!dbUser) {
      return { success: false, error: "Usuário não encontrado" };
    }

    const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(0, 80);
    const logoPath = `logos/${dbUser.id}-${Date.now()}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage.from("images").upload(logoPath, buffer, {
      contentType: file.type || "image/png",
      upsert: false,
    });

    if (uploadError) {
      console.error("[uploadMyClinicLogo]", uploadError);
      if (
        uploadError.message.includes("Bucket") ||
        uploadError.message.includes("not found")
      ) {
        return {
          success: false,
          error:
            "Bucket 'images' não encontrado no Supabase Storage. Crie o bucket no dashboard do Supabase.",
        };
      }
      return { success: false, error: `Erro ao enviar logo: ${uploadError.message}` };
    }

    const { data: publicData } = supabase.storage.from("images").getPublicUrl(logoPath);
    const clinicLogoUrl = publicData.publicUrl;

    await prisma.user.update({
      where: { email: authUser.email },
      data: { clinicLogoUrl },
    });

    revalidatePath("/dashboard/profile");
    revalidatePath("/dashboard/new-evolution");
    revalidatePath("/dashboard/generate-document");
    return { success: true, clinicLogoUrl };
  } catch (error) {
    console.error("uploadMyClinicLogo:", error);
    return { success: false, error: "Erro ao enviar logo" };
  }
}

/** Remove a logo guardada no perfil (não apaga o ficheiro antigo no Storage). */
export async function removeMyClinicLogo(): Promise<ClinicLogoResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    const rate = await enforceRateLimit(
      `profile-logo:${authUser.email.toLowerCase()}`,
      PROFILE_LOGO_RATE_LIMIT
    );
    if (!rate.allowed) {
      return {
        success: false,
        error: `Muitas alterações. Tente em ${rate.resetIn}s.`,
      };
    }

    await prisma.user.update({
      where: { email: authUser.email },
      data: { clinicLogoUrl: null },
    });

    revalidatePath("/dashboard/profile");
    revalidatePath("/dashboard/new-evolution");
    revalidatePath("/dashboard/generate-document");
    return { success: true, clinicLogoUrl: null };
  } catch (error) {
    console.error("removeMyClinicLogo:", error);
    return { success: false, error: "Erro ao remover logo" };
  }
}

// Deletar conta do usuário
// 1) Cancela assinatura/customer na Stripe (evita cobrança pós-exclusão, incl. trial)
// 2) Salva dados em RemarketingContact
// 3) Remove Auth + Prisma
export async function deleteMyAccount(): Promise<DeleteAccountResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ authUserId: authUser.id }, { email: authUser.email }],
      },
      select: {
        id: true,
        authUserId: true,
        name: true,
        email: true,
        phone: true,
        profession: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });

    if (!user) {
      return { success: false, error: "Usuário não encontrado" };
    }

    // 1. Stripe primeiro — se falhar, NÃO apaga a conta (evita cobrança órfã)
    const stripeCancel = await cancelStripeBillingForUser({
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      mode: "account_delete",
      userId: user.id,
    });
    if (!stripeCancel.ok) {
      return {
        success: false,
        error:
          "Não foi possível cancelar a assinatura na Stripe. Tente novamente ou fale com o suporte antes de excluir a conta.",
      };
    }

    // 2. Salvar dados para remarketing (não vinculados a usuário ativo)
    await prisma.remarketingContact.create({
      data: {
        email: user.email ?? "",
        name: user.name ?? null,
        profession: user.profession ?? null,
        phone: user.phone ?? null,
      },
    });

    // 3. Deletar do Supabase Auth (libera e-mail para novo cadastro)
    const authUserId = user.authUserId ?? authUser.id;
    try {
      const supabaseAdmin = createSupabaseAdminClient();
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
    } catch (authErr) {
      console.error("Erro ao deletar do Supabase Auth:", authErr);
      // Tenta continuar — pode ser que authUserId não exista (ex: login Google)
    }

    // 4. Deletar usuário do Prisma (cascade: Account, Session, UserGoal, Patients)
    await prisma.user.delete({ where: { id: user.id } });

    // 5. Logout (limpa sessão no cliente)
    await supabase.auth.signOut();

    return { success: true };
  } catch (error) {
    console.error("Erro ao deletar conta:", error);
    return { success: false, error: "Erro ao deletar conta" };
  }
}
