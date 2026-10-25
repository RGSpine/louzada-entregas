"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { getIntraUserContext } from "@/lib/intra-user/context";
import {
  DEFAULT_INTRA_USER_COLOR,
  INTRA_USER_COLOR_PALETTE,
  INTRA_USER_COOKIE,
  isValidHexColor,
  maxIntraUsersForPlan,
} from "@/lib/intra-user/constants";
import type { ActiveIntraUser } from "@/lib/intra-user/patient-scope";
import { buildPatientScopeWhere } from "@/lib/intra-user/patient-scope";
import { assertPatientAccessible } from "@/lib/intra-user/patient-access";
import {
  adminPinFormatError,
  hashAdminPin,
  isValidAdminPinFormat,
  LAB_PRINCIPAL_ADMIN_PIN,
  verifyAdminPin,
} from "@/lib/intra-user/pin";
import {
  enforceRateLimit,
  FORGOT_PASSWORD_RATE_LIMIT,
  INTRA_USER_PIN_RATE_LIMIT,
} from "@/lib/rate-limit";
import { createHash, randomBytes } from "node:crypto";
import { getAdminPinResetUrl } from "@/lib/app-url";

export type IntraUserActionResult<T = unknown> =
  | { success: true; data?: T }
  | { success: false; error: string; code?: "PIN_REQUIRED" | "PIN_SETUP_REQUIRED" };

export interface IntraUserDTO {
  id: string;
  name: string;
  color: string;
  role: "ADMIN" | "MEMBER";
  isOwner: boolean;
  isActive: boolean;
  /** ADMIN com PIN configurado (nunca o hash). */
  hasPin: boolean;
  /**
   * MEMBER: pode cadastrar planos/baixar sessões na ficha do paciente.
   * ADMIN: sempre true na UI.
   */
  canManagePatientServices: boolean;
  /** Comissão em basis points (0–10000). Só relevante em Consultório/Clínica. */
  commissionRateBps: number;
  /** Alterações de nome do administrador principal. Acima de zero, o nome fica fechado. */
  nameRevision: number;
}

function toIntraUserDTO(
  row: {
    id: string;
    name: string;
    color: string;
    role: "ADMIN" | "MEMBER";
    isOwner: boolean;
    pinHash?: string | null;
    canManagePatientServices?: boolean;
    commissionRateBps?: number;
    nameRevision?: number;
  },
  activeId: string | null,
): IntraUserDTO {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    role: row.role,
    isOwner: row.isOwner,
    isActive: row.id === activeId,
    hasPin: row.role === "ADMIN" && Boolean(row.pinHash),
    canManagePatientServices:
      row.role === "ADMIN" ? true : Boolean(row.canManagePatientServices),
    commissionRateBps: Math.min(10_000, Math.max(0, row.commissionRateBps ?? 0)),
    nameRevision: row.nameRevision ?? 0,
  };
}

function toActiveIntraUserDTO(row: {
  id: string;
  name: string;
  color: string;
  role: "ADMIN" | "MEMBER";
  isOwner: boolean;
  pinHash?: string | null;
  canManagePatientServices?: boolean;
}): ActiveIntraUser {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    role: row.role,
    isOwner: row.isOwner,
    hasPin: row.role === "ADMIN" && Boolean(row.pinHash),
    canManagePatientServices:
      row.role === "ADMIN" ? true : Boolean(row.canManagePatientServices),
  };
}

export interface TeamOverview {
  tier: string | null;
  isClinica: boolean;
  canManage: boolean;
  /** Verdadeiro quando quem está operando é o administrador principal. */
  canEditAdmin: boolean;
  maxIntraUsers: number;
  intraUserCount: number;
  activeIntraUserId: string | null;
  members: IntraUserDTO[];
}

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

function setActiveCookie(cookieStore: Awaited<ReturnType<typeof cookies>>, id: string) {
  cookieStore.set(INTRA_USER_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

const teamSetupSchema = z.object({
  people: z.array(z.string().trim().min(2).max(80)).min(1).max(10),
  adminIndex: z.number().int().min(0),
});

/** Cadastro inicial da equipe. Aparece uma vez, no primeiro acesso da conta. */
export async function completeTeamSetup(
  input: z.infer<typeof teamSetupSchema>,
): Promise<IntraUserActionResult> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };
  if (ctx.teamSetupCompleted) {
    return { success: false, error: "A equipe desta conta já foi cadastrada." };
  }

  const parsed = teamSetupSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Informe de 1 a 10 nomes e marque o administrador." };
  }

  const people = parsed.data.people.map((name) => sanitizeText(name).replace(/\s+/g, " ").trim().slice(0, 80));
  if (people.some((name) => name.length < 2)) {
    return { success: false, error: "Cada nome precisa de pelo menos 2 caracteres." };
  }
  if (parsed.data.adminIndex >= people.length) {
    return { success: false, error: "Marque qual nome é o administrador principal." };
  }
  const keys = people.map((name) => name.toLocaleLowerCase("pt-BR"));
  if (new Set(keys).size !== keys.length) {
    return { success: false, error: "Cada pessoa precisa de um nome diferente." };
  }

  const owner = await prisma.intraUser.findFirst({
    where: { userId: ctx.tenantId, isOwner: true, isMotoboy: false },
    select: { id: true },
  });
  const adminPinHash = await hashAdminPin(LAB_PRINCIPAL_ADMIN_PIN);

  await prisma.$transaction(async (tx) => {
    const adminName = people[parsed.data.adminIndex]!;
    if (owner) {
      await tx.intraUser.update({
        where: { id: owner.id },
        data: {
          name: adminName,
          role: "ADMIN",
          isOwner: true,
          nameRevision: 0,
          color: INTRA_USER_COLOR_PALETTE[0],
          pinHash: adminPinHash,
          pinUpdatedAt: new Date(),
          pinCode: LAB_PRINCIPAL_ADMIN_PIN,
        },
      });
    } else {
      await tx.intraUser.create({
        data: {
          userId: ctx.tenantId,
          name: adminName,
          role: "ADMIN",
          isOwner: true,
          nameRevision: 0,
          color: INTRA_USER_COLOR_PALETTE[0],
          pinHash: adminPinHash,
          pinUpdatedAt: new Date(),
          pinCode: LAB_PRINCIPAL_ADMIN_PIN,
        },
      });
    }

    let colorIndex = 1;
    for (let index = 0; index < people.length; index += 1) {
      if (index === parsed.data.adminIndex) continue;
      await tx.intraUser.create({
        data: {
          userId: ctx.tenantId,
          name: people[index]!,
          role: "MEMBER",
          isOwner: false,
          color: INTRA_USER_COLOR_PALETTE[colorIndex % INTRA_USER_COLOR_PALETTE.length] ?? DEFAULT_INTRA_USER_COLOR,
        },
      });
      colorIndex += 1;
    }

    await tx.user.update({
      where: { id: ctx.tenantId },
      data: { teamSetupCompletedAt: new Date() },
    });
  });

  const cookieStore = await cookies();
  cookieStore.delete(INTRA_USER_COOKIE);
  revalidatePath("/dashboard", "layout");
  return { success: true };
}

/** Lista os perfis da equipe e metadados de permissão para a UI de "Meu Perfil". */
export async function listIntraUsers(): Promise<IntraUserActionResult<TeamOverview>> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };

  const rows = await prisma.intraUser.findMany({
    where: { userId: ctx.tenantId, isMotoboy: false },
    orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      color: true,
      role: true,
      isOwner: true,
      pinHash: true,
      canManagePatientServices: true,
      commissionRateBps: true,
      nameRevision: true,
    },
  });

  const activeId = ctx.activeIntraUser?.id ?? null;

  return {
    success: true,
    data: {
      tier: ctx.tier,
      isClinica: ctx.isClinica,
      canManage: Boolean(ctx.activeIntraUser),
      canEditAdmin: ctx.activeIntraUser?.isOwner === true,
      maxIntraUsers: ctx.maxIntraUsers,
      intraUserCount: rows.length,
      activeIntraUserId: activeId,
      members: rows.map((r) => toIntraUserDTO(r, activeId)),
    },
  };
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto.").max(80),
  color: z.string().trim().optional(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
  /** Obrigatório ao criar perfil ADMIN (Opção B). */
  pin: z.string().optional(),
  /** Só aplica a MEMBER; ADMIN ignora (sempre pode). Default true. */
  canManagePatientServices: z.boolean().optional(),
});

export async function createIntraUser(
  input: z.infer<typeof createSchema>,
): Promise<IntraUserActionResult<IntraUserDTO>> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };

  if (!ctx.isClinica) {
    return {
      success: false,
      error: "Sub-usuários estão disponíveis apenas nos planos Consultório e Clínica.",
    };
  }
  if (!ctx.activeIntraUser) {
    return { success: false, error: "Escolha quem está operando para cadastrar alguém." };
  }
  if (!ctx.activeIntraUser.isOwner) {
    return {
      success: false,
      error: "Só o administrador principal pode acrescentar alguém à equipe.",
    };
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  if (parsed.data.role === "ADMIN") {
    return {
      success: false,
      error: "Um perfil novo entra como os demais. O administrador principal já foi marcado.",
    };
  }
  const pinHash: string | null = null;

  // Limite por plano (inclui o dono). Consultório = 5, Clínica = 10.
  // Count + create na mesma transação para evitar corrida acima do teto.
  const max = maxIntraUsersForPlan(ctx.tier ?? "BASICO");
  const countBeforeCreate = await prisma.intraUser.count({
    where: { userId: ctx.tenantId, isMotoboy: false },
  });
  const color =
    parsed.data.color && isValidHexColor(parsed.data.color)
      ? parsed.data.color.trim()
      : DEFAULT_INTRA_USER_COLOR;
  const name = sanitizeText(parsed.data.name).slice(0, 80) || "Profissional";

  let created: {
    id: string;
    name: string;
    color: string;
    role: "ADMIN" | "MEMBER";
    isOwner: boolean;
    pinHash: string | null;
    canManagePatientServices: boolean;
  } | null = null;

  const canManagePatientServices =
    parsed.data.role === "ADMIN"
      ? true
      : parsed.data.canManagePatientServices !== false;

  // SERIALIZABLE transforma inserções concorrentes no mesmo tenant em conflito.
  // O Prisma sinaliza esse conflito com P2034; o retry refaz count + create
  // sobre o estado mais recente, impedindo ultrapassar o limite do plano.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      created = await prisma.$transaction(
        async (tx) => {
          const count = await tx.intraUser.count({
            where: { userId: ctx.tenantId, isMotoboy: false },
          });
          if (count >= max) {
            return null;
          }
          return tx.intraUser.create({
            data: {
              userId: ctx.tenantId,
              name,
              color,
              role: parsed.data.role,
              isOwner: false,
              pinHash,
              pinUpdatedAt: pinHash ? new Date() : null,
              canManagePatientServices,
            },
            select: {
              id: true,
              name: true,
              color: true,
              role: true,
              isOwner: true,
              pinHash: true,
              canManagePatientServices: true,
            },
          });
        },
        {
          isolationLevel: "Serializable",
          maxWait: 5_000,
          timeout: 10_000,
        },
      );
      break;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : null;
      if (code === "P2034" && attempt < maxAttempts) {
        continue;
      }
      console.error("[createIntraUser] Falha na transação de limite:", error);
      return {
        success: false,
        error: "Não foi possível adicionar o profissional. Tente novamente.",
      };
    }
  }

  if (!created) {
    return {
      success: false,
      error: `Limite de ${max} usuários atingido para o plano atual. Faça upgrade para adicionar mais.`,
    };
  }

  // Ao sair de «só titular» para 2+ perfis, força «Quem está atendendo?» na próxima navegação.
  if (countBeforeCreate === 1) {
    const cookieStore = await cookies();
    cookieStore.delete(INTRA_USER_COOKIE);
  }

  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/perfil");
  return {
    success: true,
    data: toIntraUserDTO(created, null),
  };
}

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2).max(80).optional(),
  color: z.string().trim().optional(),
  role: z.enum(["ADMIN", "MEMBER"]).optional(),
  /** Obrigatório ao promover para ADMIN sem PIN prévio. */
  pin: z.string().optional(),
  /** Só aplica a MEMBER (ADMIN sempre pode gerir serviços na ficha). */
  canManagePatientServices: z.boolean().optional(),
  /** Comissão 0–10000 bps (0%–100%). ADMIN define por Intra User. */
  commissionRateBps: z.number().int().min(0).max(10_000).optional(),
});

export async function updateIntraUser(
  input: z.infer<typeof updateSchema>,
): Promise<IntraUserActionResult<IntraUserDTO>> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };
  if (!ctx.isClinica) {
    return {
      success: false,
      error: "Gerenciamento de equipe disponível apenas nos planos Consultório e Clínica.",
    };
  }
  if (!ctx.activeIntraUser) {
    return { success: false, error: "Escolha quem está operando." };
  }

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const target = await prisma.intraUser.findFirst({
    where: { id: parsed.data.id, userId: ctx.tenantId },
  });
  if (!target) return { success: false, error: "Perfil não encontrado." };
  if (target.isOwner && ctx.activeIntraUser.id !== target.id) {
    return {
      success: false,
      error: "O administrador principal só pode ser alterado por ele mesmo.",
    };
  }

  // O dono é sempre ADMIN e não pode ser rebaixado.
  if (target.isOwner && parsed.data.role && parsed.data.role !== "ADMIN") {
    return { success: false, error: "O titular da conta deve permanecer como administrador." };
  }

  const data: {
    name?: string;
    color?: string;
    role?: "ADMIN" | "MEMBER";
    pinHash?: string | null;
    pinCode?: string | null;
    pinUpdatedAt?: Date | null;
    canManagePatientServices?: boolean;
    commissionRateBps?: number;
    nameRevision?: number;
  } = {};
  if (parsed.data.name) {
    const nextName = sanitizeText(parsed.data.name).slice(0, 80) || target.name;
    if (target.isOwner && nextName !== target.name) {
      if (target.nameRevision >= 1) {
        return {
          success: false,
          error: "O administrador principal só pode ter o nome ajustado uma vez.",
        };
      }
      data.nameRevision = target.nameRevision + 1;
    }
    data.name = nextName;
  }
  if (parsed.data.color && isValidHexColor(parsed.data.color)) data.color = parsed.data.color.trim();
  if (parsed.data.role && !target.isOwner) data.role = parsed.data.role;
  if (parsed.data.commissionRateBps !== undefined) {
    data.commissionRateBps = parsed.data.commissionRateBps;
  }

  const nextRole = data.role ?? target.role;
  if (parsed.data.canManagePatientServices !== undefined) {
    // ADMIN sempre true; MEMBER respeita o toggle do administrador.
    data.canManagePatientServices =
      nextRole === "ADMIN" ? true : parsed.data.canManagePatientServices;
  } else if (data.role === "ADMIN") {
    data.canManagePatientServices = true;
  }

  if (nextRole === "ADMIN" && !target.pinHash) {
    const pin = parsed.data.pin?.trim() ?? "";
    if (!isValidAdminPinFormat(pin)) {
      return {
        success: false,
        error: `Ao promover para administrador, informe um PIN. ${adminPinFormatError()}`,
        code: "PIN_SETUP_REQUIRED",
      };
    }
    data.pinHash = await hashAdminPin(pin);
    data.pinUpdatedAt = new Date();
    if (/^\d{4}$/.test(pin)) data.pinCode = pin;
  }
  if (nextRole === "MEMBER" && target.role === "ADMIN" && !target.isOwner) {
    // Rebaixa: remove PIN (MEMBER não usa).
    data.pinHash = null;
    data.pinCode = null;
    data.pinUpdatedAt = null;
  }

  const updated = await prisma.intraUser.update({
    where: { id: target.id },
    data,
  });

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/perfil");
  revalidatePath("/dashboard/patients", "layout");
  return {
    success: true,
    data: toIntraUserDTO(updated, ctx.activeIntraUser?.id ?? null),
  };
}

export async function deleteIntraUser(id: string): Promise<IntraUserActionResult> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };
  if (!ctx.activeIntraUser) {
    return { success: false, error: "Escolha quem está operando." };
  }
  if (!ctx.activeIntraUser.isOwner) {
    return {
      success: false,
      error: "Só o administrador principal pode remover alguém da equipe.",
    };
  }

  const target = await prisma.intraUser.findFirst({
    where: { id, userId: ctx.tenantId },
  });
  if (!target) return { success: false, error: "Perfil não encontrado." };
  if (target.isOwner) {
    return { success: false, error: "O administrador principal não pode ser removido." };
  }

  // Reatribui pacientes do membro ao titular. Mantém isShared original:
  // compartilhamento deve ser explícito; ADMIN já vê todos do tenant.
  const owner = await prisma.intraUser.findFirst({
    where: { userId: ctx.tenantId, isOwner: true },
    select: { id: true },
  });
  if (!owner) {
    // Toda conta deve ter um titular (backfill da migração + bootstrap lazy).
    // Falhar aqui evita mascarar inconsistência e criar pacientes órfãos.
    console.error(
      `[intra-users] Tenant ${ctx.tenantId} sem IntraUser titular ao remover perfil ${target.id}.`,
    );
    return {
      success: false,
      error: "Não foi possível remover o perfil: titular da conta não encontrado. Contate o suporte.",
    };
  }
  // Após o early-return acima, owner é garantido — captura o id para a transação.
  const ownerId = owner.id;

  await prisma.$transaction([
    prisma.patient.updateMany({
      where: { userId: ctx.tenantId, ownerId: target.id },
      data: { ownerId },
    }),
    prisma.intraUser.delete({ where: { id: target.id } }),
  ]);

  // Se o perfil ativo era o removido, limpa o cookie.
  const cookieStore = await cookies();
  if (cookieStore.get(INTRA_USER_COOKIE)?.value === target.id) {
    cookieStore.delete(INTRA_USER_COOKIE);
  }

  revalidatePath("/dashboard/perfil");
  return { success: true };
}

export interface PatientSharingState {
  isShared: boolean;
  /** Viewer pode alternar o compartilhamento (dono do paciente ou ADMIN). */
  canManage: boolean;
  /** Conta de equipe (Consultório/Clínica) — controla exibição do toggle. */
  isTeamPlan: boolean;
  ownerName: string | null;
}

/** Estado de compartilhamento de um paciente para a UI (toggle na página do paciente). */
export async function getPatientSharingState(
  patientId: string,
): Promise<IntraUserActionResult<PatientSharingState>> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };
  if (ctx.requiresProfileSelection || !ctx.activeIntraUser) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }

  // Escopo Intra User: paciente fora do acesso → 404 genérico (sem vazar metadados).
  const access = await assertPatientAccessible(patientId);
  if (!access.ok || !access.scope) {
    return { success: false, error: "Paciente não encontrado." };
  }

  const patient = await prisma.patient.findFirst({
    where: {
      ...buildPatientScopeWhere(access.scope),
      id: patientId,
    },
    select: { id: true, isShared: true, ownerId: true, owner: { select: { name: true } } },
  });
  if (!patient) return { success: false, error: "Paciente não encontrado." };

  const isOwner = patient.ownerId === ctx.activeIntraUser.id;
  const isAdmin = ctx.activeIntraUser.role === "ADMIN";

  return {
    success: true,
    data: {
      isShared: patient.isShared,
      canManage: ctx.isClinica && (isOwner || isAdmin),
      isTeamPlan: ctx.isClinica,
      ownerName: patient.owner?.name ?? null,
    },
  };
}

/** Alterna o compartilhamento do paciente com a clínica (apenas dono ou ADMIN). */
export async function setPatientSharing(
  patientId: string,
  isShared: boolean,
): Promise<IntraUserActionResult<{ isShared: boolean }>> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };
  if (ctx.requiresProfileSelection || !ctx.activeIntraUser) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }

  const access = await assertPatientAccessible(patientId);
  if (!access.ok || !access.scope) {
    return { success: false, error: "Paciente não encontrado." };
  }

  const patient = await prisma.patient.findFirst({
    where: {
      ...buildPatientScopeWhere(access.scope),
      id: patientId,
    },
    select: { id: true, ownerId: true },
  });
  if (!patient) return { success: false, error: "Paciente não encontrado." };

  const isOwner = patient.ownerId === ctx.activeIntraUser.id;
  const isAdmin = ctx.activeIntraUser.role === "ADMIN";
  if (!(isOwner || isAdmin)) {
    return { success: false, error: "Apenas o dono do paciente pode alterar o compartilhamento." };
  }

  await prisma.patient.update({
    where: { id: patient.id },
    data: { isShared },
  });

  revalidatePath(`/dashboard/patients/${patientId}`);
  return { success: true, data: { isShared } };
}

/**
 * Limpa o perfil Intra User ativo (cookie) e força a tela «Quem está atendendo?».
 * Usado pelo chip de troca no chrome e após login em contas de equipe.
 */
export async function clearActiveIntraUserSession(): Promise<IntraUserActionResult> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };

  const cookieStore = await cookies();
  cookieStore.delete(INTRA_USER_COOKIE);
  revalidatePath("/dashboard", "layout");
  return { success: true };
}

/** Define o perfil (Intra User) ativo da sessão via cookie.
 * Opção B: MEMBER troca livre; ADMIN exige PIN (ou setup inicial).
 */
export async function switchActiveIntraUser(
  id: string,
  pin?: string,
): Promise<IntraUserActionResult<ActiveIntraUser>> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };

  const target = await prisma.intraUser.findFirst({
    where: { id, userId: ctx.tenantId },
  });
  if (!target) return { success: false, error: "Perfil não encontrado." };

  if (target.isOwner) {
    if (!target.pinHash) {
      const pinHash = await hashAdminPin(LAB_PRINCIPAL_ADMIN_PIN);
      await prisma.intraUser.update({
        where: { id: target.id },
        data: { pinHash, pinCode: LAB_PRINCIPAL_ADMIN_PIN, pinUpdatedAt: new Date() },
      });
      target.pinHash = pinHash;
    }

    const rl = await enforceRateLimit(
      `intra-pin:${ctx.tenantId}:${target.id}`,
      INTRA_USER_PIN_RATE_LIMIT,
    );
    if (!rl.allowed) {
      return {
        success: false,
        error: `Muitas tentativas. Aguarde ${rl.resetIn}s e tente novamente.`,
        code: "PIN_REQUIRED",
      };
    }

    const ok = await verifyAdminPin(pin?.trim() ?? "", target.pinHash);
    if (!ok) {
      return {
        success: false,
        error: "PIN incorreto.",
        code: "PIN_REQUIRED",
      };
    }
  }

  const cookieStore = await cookies();
  setActiveCookie(cookieStore, target.id);

  revalidatePath("/dashboard", "layout");
  return {
    success: true,
    data: toActiveIntraUserDTO(target),
  };
}

function hashPinResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Envia ao e-mail da conta um link para trocar o PIN do administrador principal. */
export async function requestAdminPinReset(email: string): Promise<IntraUserActionResult> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };

  const typed = email.trim().toLowerCase();
  if (!typed.includes("@")) {
    return { success: false, error: "Informe o e-mail cadastrado nesta conta." };
  }

  const rl = await enforceRateLimit(
    `admin-pin-reset:${ctx.tenantId}`,
    FORGOT_PASSWORD_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return {
      success: false,
      error: `Aguarde ${rl.resetIn}s antes de solicitar outro e-mail.`,
    };
  }

  const account = await prisma.user.findFirst({
    where: { id: ctx.tenantId },
    select: { email: true, name: true },
  });
  const accountEmail = account?.email?.trim().toLowerCase() ?? "";
  if (!accountEmail || typed !== accountEmail) {
    return { success: false, error: "Use o e-mail cadastrado nesta conta." };
  }

  const owner = await prisma.intraUser.findFirst({
    where: { userId: ctx.tenantId, isOwner: true, isMotoboy: false },
    select: { id: true, name: true },
  });
  if (!owner) return { success: false, error: "Administrador principal não encontrado." };

  const token = randomBytes(32).toString("base64url");
  await prisma.intraUser.update({
    where: { id: owner.id },
    data: {
      pinResetTokenHash: hashPinResetToken(token),
      pinResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const { sendAdminPinResetEmail } = await import("@/lib/email");
  const sent = await sendAdminPinResetEmail(
    accountEmail,
    getAdminPinResetUrl(token),
    owner.name || account?.name || undefined,
  );
  if (!sent.success) {
    return { success: false, error: "Não foi possível enviar o e-mail. Tente novamente em instantes." };
  }
  return { success: true };
}

const confirmPinResetSchema = z.object({
  token: z.string().trim().min(20),
  pin: z.string().trim().regex(/^\d{4}$/, "O PIN tem 4 números."),
  confirmPin: z.string().trim(),
});

/** Consome o link do e-mail e grava o novo PIN do administrador principal. */
export async function confirmAdminPinReset(
  input: z.infer<typeof confirmPinResetSchema>,
): Promise<IntraUserActionResult> {
  const parsed = confirmPinResetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  if (parsed.data.pin !== parsed.data.confirmPin) {
    return { success: false, error: "Os PINs não coincidem." };
  }

  const owner = await prisma.intraUser.findFirst({
    where: {
      isOwner: true,
      pinResetTokenHash: hashPinResetToken(parsed.data.token),
    },
    select: { id: true, pinResetExpiresAt: true },
  });
  if (!owner || !owner.pinResetExpiresAt || owner.pinResetExpiresAt.getTime() < Date.now()) {
    return { success: false, error: "Este link expirou. Peça outro em Esqueci o PIN." };
  }

  await prisma.intraUser.update({
    where: { id: owner.id },
    data: {
      pinHash: await hashAdminPin(parsed.data.pin),
      pinCode: parsed.data.pin,
      pinUpdatedAt: new Date(),
      pinResetTokenHash: null,
      pinResetExpiresAt: null,
    },
  });
  return { success: true };
}

const setPinSchema = z.object({
  intraUserId: z.string().min(1),
  pin: z.string().trim(),
  confirmPin: z.string().trim(),
  /** Se true, ativa o perfil após definir o PIN (fluxo do gate). */
  activate: z.boolean().optional(),
});

/**
 * Define o PIN de um perfil ADMIN (primeira configuração ou redefinição por outro ADMIN).
 * Conta autenticada do tenant; rate-limited.
 */
export async function setAdminIntraUserPin(
  input: z.infer<typeof setPinSchema>,
): Promise<IntraUserActionResult<ActiveIntraUser>> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };
  if (!ctx.isClinica) {
    return { success: false, error: "PIN disponível apenas em planos de equipe." };
  }

  const parsed = setPinSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const { intraUserId, pin, confirmPin, activate } = parsed.data;
  if (pin !== confirmPin) {
    return { success: false, error: "Os PINs não coincidem." };
  }
  if (!/^\d{4}$/.test(pin)) {
    return { success: false, error: "O PIN do administrador tem 4 números." };
  }

  const target = await prisma.intraUser.findFirst({
    where: { id: intraUserId, userId: ctx.tenantId },
    select: {
      id: true,
      name: true,
      color: true,
      role: true,
      isOwner: true,
      pinHash: true,
      canManagePatientServices: true,
    },
  });
  if (!target) return { success: false, error: "Perfil não encontrado." };
  if (target.role !== "ADMIN") {
    return { success: false, error: "Apenas perfis administrador usam PIN." };
  }

  // Já tem PIN: alteração exige o PIN atual via changeAdminIntraUserPin.
  if (target.pinHash) {
    return {
      success: false,
      error: "Este perfil já tem PIN. Use «Alterar PIN» e informe o PIN atual.",
    };
  }

  // Setup inicial (sem PIN): ADMIN ativo, ou tela de seleção de perfil (gate).
  const canSetup =
    ctx.activeIntraUser?.role === "ADMIN" ||
    ctx.requiresProfileSelection ||
    !ctx.activeIntraUser;
  if (!canSetup) {
    return {
      success: false,
      error: "Apenas um administrador pode definir o PIN.",
    };
  }

  const rl = await enforceRateLimit(
    `intra-pin-set:${ctx.tenantId}:${target.id}`,
    INTRA_USER_PIN_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return {
      success: false,
      error: `Muitas tentativas. Aguarde ${rl.resetIn}s e tente novamente.`,
    };
  }

  const pinHash = await hashAdminPin(pin);
  await prisma.intraUser.update({
    where: { id: target.id },
    data: { pinHash, pinCode: pin, pinUpdatedAt: new Date() },
  });

  if (activate) {
    const cookieStore = await cookies();
    setActiveCookie(cookieStore, target.id);
    revalidatePath("/dashboard", "layout");
  } else {
    revalidatePath("/dashboard/perfil");
  }

  return {
    success: true,
    data: toActiveIntraUserDTO({ ...target, pinHash: "set" }),
  };
}

/** PIN atual do administrador principal, só para ele ver e alterar no perfil. */
export async function getOwnerAdminPin(): Promise<IntraUserActionResult<{ pin: string | null }>> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };
  if (!ctx.activeIntraUser?.isOwner) {
    return { success: false, error: "Só o administrador principal vê o PIN." };
  }

  const owner = await prisma.intraUser.findFirst({
    where: { id: ctx.activeIntraUser.id, userId: ctx.tenantId, isOwner: true },
    select: { id: true, pinHash: true, pinCode: true },
  });
  if (!owner) return { success: false, error: "Administrador não encontrado." };

  if (owner.pinCode && /^\d{4}$/.test(owner.pinCode)) {
    return { success: true, data: { pin: owner.pinCode } };
  }

  if (owner.pinHash && (await verifyAdminPin(LAB_PRINCIPAL_ADMIN_PIN, owner.pinHash))) {
    await prisma.intraUser.update({
      where: { id: owner.id },
      data: { pinCode: LAB_PRINCIPAL_ADMIN_PIN },
    });
    return { success: true, data: { pin: LAB_PRINCIPAL_ADMIN_PIN } };
  }

  return { success: true, data: { pin: null } };
}

const changePinSchema = z.object({
  currentPin: z.string().trim(),
  newPin: z.string().trim(),
  confirmPin: z.string().trim(),
});

/** Troca o PIN do perfil ADMIN ativo (exige PIN atual). */
export async function changeAdminIntraUserPin(
  input: z.infer<typeof changePinSchema>,
): Promise<IntraUserActionResult> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { success: false, error: "Não autenticado." };
  if (!ctx.activeIntraUser?.isOwner) {
    return { success: false, error: "Só o administrador principal altera o PIN." };
  }

  const parsed = changePinSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  if (parsed.data.newPin !== parsed.data.confirmPin) {
    return { success: false, error: "Os PINs novos não coincidem." };
  }
  if (!/^\d{4}$/.test(parsed.data.newPin)) {
    return { success: false, error: "O PIN do administrador tem 4 números." };
  }

  const target = await prisma.intraUser.findFirst({
    where: { id: ctx.activeIntraUser.id, userId: ctx.tenantId },
    select: { id: true, pinHash: true, role: true },
  });
  if (!target || target.role !== "ADMIN") {
    return { success: false, error: "Perfil não encontrado." };
  }
  if (!target.pinHash) {
    return {
      success: false,
      error: "Este perfil ainda não tem PIN. Use a definição inicial de PIN.",
      code: "PIN_SETUP_REQUIRED",
    };
  }

  const rl = await enforceRateLimit(
    `intra-pin:${ctx.tenantId}:${target.id}`,
    INTRA_USER_PIN_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return {
      success: false,
      error: `Muitas tentativas. Aguarde ${rl.resetIn}s e tente novamente.`,
    };
  }

  const ok = await verifyAdminPin(parsed.data.currentPin, target.pinHash);
  if (!ok) {
    return { success: false, error: "PIN atual incorreto.", code: "PIN_REQUIRED" };
  }

  const pinHash = await hashAdminPin(parsed.data.newPin);
  await prisma.intraUser.update({
    where: { id: target.id },
    data: { pinHash, pinCode: parsed.data.newPin, pinUpdatedAt: new Date() },
  });

  revalidatePath("/dashboard/perfil");
  return { success: true };
}
