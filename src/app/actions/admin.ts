"use server";

import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { Role } from "@prisma/client";
import { hasAdminRole, isPlatformOwnerEmail, resolveSessionEmail } from "@/lib/plan-limits";
import { getUserActivityStatsMap } from "@/lib/admin-user-activity";
import { cancelStripeBillingForUser } from "@/lib/stripe-billing-cancel";

export interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  avatarUrl: string | null;
  role: Role;
  isBlocked: boolean;
  profession: string | null;
  councilType: string | null;
  councilNumber: string | null;
  phone: string | null;
  /** Plano comercial (null = sem checkout). */
  plan: string | null;
  /** INCOMPLETE | ACTIVE | BLOCKED */
  accountStatus: string;
  /** Checkout Stripe ainda não concluído */
  basicoCheckoutRequired: boolean;
  stripeSubscriptionId: string | null;
  /** Acesso PRO via parceria (sem Stripe) */
  isInfluencer: boolean;
  createdAt: Date;
  /** Total de evoluções salvas (todas). */
  totalEvolutions: number;
  /** Último acesso ao app ou última evolução. */
  lastActiveAt: Date | null;
}

export interface AdminStats {
  totalUsers: number;
  totalAdmins: number;
  totalPatients: number;
  totalEvolutions: number;
}

export interface GetCurrentAdminResult {
  success: boolean;
  isAdmin: boolean;
  user?: AdminUser;
  error?: string;
}

export interface GetAllUsersResult {
  success: boolean;
  users?: AdminUser[];
  error?: string;
}

export interface DeleteUserResult {
  success: boolean;
  error?: string;
}

export interface GetAdminStatsResult {
  success: boolean;
  stats?: AdminStats;
  error?: string;
}

// Verifica se o usuário atual é admin
export async function getCurrentAdmin(): Promise<GetCurrentAdminResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser) {
      console.warn("[getCurrentAdmin] Não autenticado:", authError?.message);
      return { success: false, isAdmin: false, error: "Usuário não autenticado" };
    }

    const sessionEmail = resolveSessionEmail(authUser.email, null);

    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [
          { authUserId: authUser.id },
          { email: authUser.email ?? "" },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        avatarUrl: true,
        role: true,
        isBlocked: true,
        profession: true,
        councilType: true,
        councilNumber: true,
        phone: true,
        plan: true,
        accountStatus: true,
        basicoCheckoutRequired: true,
        stripeSubscriptionId: true,
        isInfluencer: true,
        createdAt: true,
      },
    });

    if (!dbUser) {
      if (isPlatformOwnerEmail(sessionEmail)) {
        console.warn("[getCurrentAdmin] Dono sem registro Prisma; acesso admin concedido.");
        return {
          success: true,
          isAdmin: true,
          user: {
            id: authUser.id,
            name: null,
            email: sessionEmail,
            image: null,
            avatarUrl: null,
            role: Role.ADMIN,
            isBlocked: false,
            profession: null,
            councilType: null,
            councilNumber: null,
            phone: null,
            plan: "PREMIUM",
            accountStatus: "ACTIVE",
            basicoCheckoutRequired: false,
            stripeSubscriptionId: null,
            isInfluencer: false,
            createdAt: new Date(),
            totalEvolutions: 0,
            lastActiveAt: null,
          },
        };
      }
      console.warn("[getCurrentAdmin] Usuário não encontrado. authId:", authUser.id, "authEmail:", authUser.email);
      return { success: false, isAdmin: false, error: "Usuário não encontrado no banco" };
    }

    const resolvedEmail = resolveSessionEmail(authUser.email, dbUser.email);
    console.log("[getCurrentAdmin] authEmail:", authUser.email, "dbEmail:", dbUser.email, "resolved:", resolvedEmail, "role:", dbUser.role);

    if (!hasAdminRole(dbUser.role, resolvedEmail)) {
      return { success: true, isAdmin: false };
    }

    return {
      success: true,
      isAdmin: true,
      user: {
        ...dbUser,
        role: Role.ADMIN,
        totalEvolutions: 0,
        lastActiveAt: null,
      },
    };
  } catch (error) {
    console.error("[getCurrentAdmin] Erro ao verificar admin:", error);
    try {
      const supabase = await createSupabaseServerClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (isPlatformOwnerEmail(authUser?.email)) {
        return {
          success: true,
          isAdmin: true,
          user: {
            id: authUser!.id,
            name: null,
            email: authUser!.email ?? null,
            image: null,
            avatarUrl: null,
            role: Role.ADMIN,
            isBlocked: false,
            profession: null,
            councilType: null,
            councilNumber: null,
            phone: null,
          plan: "PREMIUM",
          accountStatus: "ACTIVE",
          basicoCheckoutRequired: false,
          stripeSubscriptionId: null,
            isInfluencer: false,
            createdAt: new Date(),
            totalEvolutions: 0,
            lastActiveAt: null,
          },
        };
      }
    } catch {
      // ignore fallback errors
    }
    return { success: false, isAdmin: false, error: "Erro ao verificar permissões" };
  }
}

// Busca todos os usuários
export async function getAllUsers(): Promise<GetAllUsersResult> {
  try {
    // Primeiro verifica se é admin
    const adminCheck = await getCurrentAdmin();
    if (!adminCheck.success || !adminCheck.isAdmin) {
      return { success: false, error: "Acesso negado. Apenas administradores." };
    }

    const userSelect = {
      id: true,
      name: true,
      email: true,
      image: true,
      avatarUrl: true,
      role: true,
      isBlocked: true,
      profession: true,
      councilType: true,
      councilNumber: true,
      phone: true,
      plan: true,
      accountStatus: true,
      basicoCheckoutRequired: true,
      stripeSubscriptionId: true,
      isInfluencer: true,
      createdAt: true,
    } as const;

    let users;
    try {
      users = await prisma.user.findMany({
        select: userSelect,
        orderBy: { createdAt: "desc" },
      });
    } catch (parseError) {
      // Resiliência: registros legados com plan=null quebram o client tipado String.
      console.error(
        "[admin/getAllUsers] findMany falhou (sanitizando plan null → NONE):",
        parseError,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET plan = 'NONE' WHERE plan IS NULL`,
      );
      users = await prisma.user.findMany({
        select: userSelect,
        orderBy: { createdAt: "desc" },
      });
    }

    const activityMap = await getUserActivityStatsMap(users.map((u) => u.id));

    return {
      success: true,
      users: users.map((u) => {
        const activity = activityMap.get(u.id);
        return {
          ...u,
          totalEvolutions: activity?.totalEvolutions ?? 0,
          lastActiveAt: activity?.lastActiveAt ?? null,
        };
      }),
    };
  } catch (error) {
    console.error("Erro ao buscar usuários:", error);
    return { success: false, error: "Erro ao buscar usuários" };
  }
}

// Busca estatísticas do sistema
export async function getAdminStats(): Promise<GetAdminStatsResult> {
  try {
    // Primeiro verifica se é admin
    const adminCheck = await getCurrentAdmin();
    if (!adminCheck.success || !adminCheck.isAdmin) {
      return { success: false, error: "Acesso negado. Apenas administradores." };
    }

    const [totalUsers, totalAdmins, totalPatients, totalEvolutions] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "ADMIN" } }),
      prisma.patient.count(),
      prisma.evolution.count(),
    ]);

    return {
      success: true,
      stats: {
        totalUsers,
        totalAdmins,
        totalPatients,
        totalEvolutions,
      },
    };
  } catch (error) {
    console.error("Erro ao buscar estatísticas:", error);
    return { success: false, error: "Erro ao buscar estatísticas" };
  }
}

// Deleta um usuário
export async function deleteUser(userId: string): Promise<DeleteUserResult> {
  try {
    // Primeiro verifica se é admin
    const adminCheck = await getCurrentAdmin();
    if (!adminCheck.success || !adminCheck.isAdmin) {
      return { success: false, error: "Acesso negado. Apenas administradores." };
    }

    // Não permitir deletar a si mesmo
    if (adminCheck.user?.id === userId) {
      return { success: false, error: "Você não pode deletar sua própria conta." };
    }

    const userToDelete = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        authUserId: true,
        email: true,
        name: true,
        phone: true,
        profession: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });

    if (!userToDelete) {
      return { success: false, error: "Usuário não encontrado." };
    }

    if (isPlatformOwnerEmail(userToDelete.email)) {
      return { success: false, error: "Não é possível remover o administrador principal da plataforma." };
    }

    const stripeCancel = await cancelStripeBillingForUser({
      stripeCustomerId: userToDelete.stripeCustomerId,
      stripeSubscriptionId: userToDelete.stripeSubscriptionId,
      mode: "account_delete",
      userId: userToDelete.id,
    });
    if (!stripeCancel.ok) {
      return {
        success: false,
        error:
          "Não foi possível cancelar a assinatura Stripe deste utilizador. Resolva na Stripe e tente de novo.",
      };
    }

    // Salvar dados para remarketing (admin)
    await prisma.remarketingContact.create({
      data: {
        email: userToDelete.email ?? "",
        name: userToDelete.name ?? null,
        profession: userToDelete.profession ?? null,
        phone: userToDelete.phone ?? null,
      },
    });

    // Deletar do Supabase Auth (usa authUserId, não userId do Prisma)
    const authUserId = userToDelete.authUserId ?? userToDelete.id;
    try {
      const supabaseAdmin = createSupabaseAdminClient();
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
    } catch (authError) {
      console.warn("Não foi possível deletar do Supabase Auth:", authError);
    }

    // Deleta o usuário do Prisma (cascade deleta Account, Session, UserGoal, etc.)
    await prisma.user.delete({
      where: { id: userId },
    });

    return { success: true };
  } catch (error) {
    console.error("Erro ao deletar usuário:", error);
    return { success: false, error: "Erro ao deletar usuário" };
  }
}

// Altera o role de um usuário
export async function updateUserRole(userId: string, newRole: Role): Promise<DeleteUserResult> {
  try {
    // Primeiro verifica se é admin
    const adminCheck = await getCurrentAdmin();
    if (!adminCheck.success || !adminCheck.isAdmin) {
      return { success: false, error: "Acesso negado. Apenas administradores." };
    }

    // Não permitir alterar a si mesmo
    if (adminCheck.user?.id === userId) {
      return { success: false, error: "Você não pode alterar seu próprio cargo." };
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (targetUser && isPlatformOwnerEmail(targetUser.email)) {
      return { success: false, error: "O cargo do administrador principal não pode ser alterado." };
    }

    // Atualiza o role
    await prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
    });

    return { success: true };
  } catch (error) {
    console.error("Erro ao atualizar role:", error);
    return { success: false, error: "Erro ao atualizar cargo do usuário" };
  }
}

// Alterna o status de bloqueio de um usuário
export async function toggleUserBlockStatus(
  userId: string, 
  currentStatus: boolean
): Promise<DeleteUserResult> {
  try {
    // Primeiro verifica se é admin
    const adminCheck = await getCurrentAdmin();
    if (!adminCheck.success || !adminCheck.isAdmin) {
      return { success: false, error: "Acesso negado. Apenas administradores." };
    }

    // Não permitir bloquear a si mesmo
    if (adminCheck.user?.id === userId) {
      return { success: false, error: "Você não pode bloquear sua própria conta." };
    }

    // Verifica se o usuário existe
    const userToUpdate = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, email: true },
    });

    if (!userToUpdate) {
      return { success: false, error: "Usuário não encontrado." };
    }

    if (isPlatformOwnerEmail(userToUpdate.email)) {
      return { success: false, error: "Não é possível bloquear o administrador principal." };
    }

    // Não permitir bloquear outros admins
    if (!currentStatus && userToUpdate.role === "ADMIN") {
      return { success: false, error: "Não é possível bloquear outro administrador." };
    }

    // Alterna o status de bloqueio
    await prisma.user.update({
      where: { id: userId },
      data: { isBlocked: !currentStatus },
    });

    return { success: true };
  } catch (error) {
    console.error("Erro ao alterar status de bloqueio:", error);
    return { success: false, error: "Erro ao alterar status do usuário" };
  }
}

/**
 * Marca ou remove parceria de influenciador: acesso Premium, sem novas cobranças.
 * Ao ativar com assinatura Stripe aberta: pausa a cobrança (`pause_collection`)
 * — o período já pago segue válido; as próximas faturas são anuladas.
 * Os IDs Stripe permanecem para o webhook e para retomar a cobrança ao sair da parceria.
 */
export async function setUserInfluencerStatus(
  userId: string,
  enabled: boolean
): Promise<DeleteUserResult> {
  try {
    const adminCheck = await getCurrentAdmin();
    if (!adminCheck.success || !adminCheck.isAdmin) {
      return { success: false, error: "Acesso negado. Apenas administradores." };
    }

    if (adminCheck.user?.id === userId) {
      return { success: false, error: "Você não pode alterar a si mesmo." };
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });
    if (!target) {
      return { success: false, error: "Usuário não encontrado." };
    }
    if (target.role === "ADMIN") {
      return { success: false, error: "Não aplicável a administradores." };
    }

    if (enabled) {
      const { pauseStripeBillingForInfluencer } = await import(
        "@/lib/stripe-influencer-pause"
      );
      const paused = await pauseStripeBillingForInfluencer({
        stripeCustomerId: target.stripeCustomerId,
        stripeSubscriptionId: target.stripeSubscriptionId,
      });
      if (!paused.ok) {
        return {
          success: false,
          error:
            paused.error ??
            "Não foi possível pausar a cobrança na Stripe. A parceria não foi aplicada.",
        };
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          isInfluencer: true,
          plan: "PREMIUM",
          accountStatus: "ACTIVE",
          basicoCheckoutRequired: false,
          stripeCancelAtPeriodEnd: false,
        },
      });
    } else {
      const { resumeStripeBillingAfterInfluencer } = await import(
        "@/lib/stripe-influencer-pause"
      );
      const resumed = await resumeStripeBillingAfterInfluencer({
        stripeCustomerId: target.stripeCustomerId,
        stripeSubscriptionId: target.stripeSubscriptionId,
      });
      if (!resumed.ok) {
        return {
          success: false,
          error:
            resumed.error ??
            "Não foi possível retomar a cobrança na Stripe. A parceria não foi removida.",
        };
      }

      const stillOnStripe = Boolean(
        target.stripeSubscriptionId || target.stripeCustomerId,
      );
      await prisma.user.update({
        where: { id: userId },
        data: stillOnStripe
          ? {
              isInfluencer: false,
              basicoCheckoutRequired: false,
            }
          : {
              isInfluencer: false,
              plan: "NONE",
              accountStatus: "INCOMPLETE",
              basicoCheckoutRequired: true,
              stripeSubscriptionId: null,
              stripePriceId: null,
              currentPeriodEnd: null,
              planInterval: null,
            },
      });
    }

    return { success: true };
  } catch (error) {
    console.error("Erro ao definir influenciador:", error);
    return { success: false, error: "Erro ao atualizar parceria de influenciador." };
  }
}

// ========== EXTRAÇÃO DE CONTATOS PARA REMARKETING ==========

export interface ContactExport {
  name: string | null;
  email: string | null;
  phone: string | null;
  profession: string | null;
}

export interface ExportContactsResult {
  success: boolean;
  contacts?: ContactExport[];
  count?: number;
  error?: string;
}

// Lista todas as profissões disponíveis
export async function getAvailableProfessions(): Promise<{ success: boolean; professions?: string[]; error?: string }> {
  try {
    const adminCheck = await getCurrentAdmin();
    if (!adminCheck.success || !adminCheck.isAdmin) {
      return { success: false, error: "Acesso negado. Apenas administradores." };
    }

    const professions = await prisma.user.findMany({
      where: {
        profession: { not: null },
      },
      select: { profession: true },
      distinct: ['profession'],
    });

    const uniqueProfessions = professions
      .map(p => p.profession)
      .filter((p): p is string => p !== null)
      .sort();

    return { success: true, professions: uniqueProfessions };
  } catch (error) {
    console.error("Erro ao buscar profissões:", error);
    return { success: false, error: "Erro ao buscar profissões" };
  }
}

// Exporta contatos filtrados por profissão
export async function exportContactsByProfession(
  professions: string[], // Array de profissões para filtrar
  exportType: 'email' | 'phone' | 'both'
): Promise<ExportContactsResult> {
  try {
    const adminCheck = await getCurrentAdmin();
    if (!adminCheck.success || !adminCheck.isAdmin) {
      return { success: false, error: "Acesso negado. Apenas administradores." };
    }

    // Construir filtro de profissões
    const whereClause = professions.length > 0 
      ? {
          profession: {
            in: professions,
            mode: 'insensitive' as const,
          },
          isBlocked: false, // Apenas usuários ativos
        }
      : {
          isBlocked: false,
        };

    const users = await prisma.user.findMany({
      where: whereClause,
      select: {
        name: true,
        email: exportType === 'phone' ? false : true,
        phone: exportType === 'email' ? false : true,
        profession: true,
      },
      orderBy: { profession: 'asc' },
    });

    const contacts: ContactExport[] = users.map(u => ({
      name: u.name,
      email: 'email' in u ? u.email : null,
      phone: 'phone' in u ? u.phone : null,
      profession: u.profession,
    }));

    // Filtrar apenas contatos que têm o dado solicitado
    const filteredContacts = contacts.filter(c => {
      if (exportType === 'email') return c.email !== null && c.email !== '';
      if (exportType === 'phone') return c.phone !== null && c.phone !== '';
      return (c.email !== null && c.email !== '') || (c.phone !== null && c.phone !== '');
    });

    return { 
      success: true, 
      contacts: filteredContacts,
      count: filteredContacts.length,
    };
  } catch (error) {
    console.error("Erro ao exportar contatos:", error);
    return { success: false, error: "Erro ao exportar contatos" };
  }
}
