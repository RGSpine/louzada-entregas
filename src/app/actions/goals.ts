"use server";

import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

// ========== TIPOS ==========

export interface UserGoalData {
  id: string;
  type: string; // "MONTHLY" ou "WEEKLY"
  target: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoalWithProgress {
  goal: UserGoalData;
  currentProgress: number;
  progressPercent: number;
  daysRemaining: number;
  periodEndDate: Date;
  milestoneAlert?: MilestoneAlert; // Alerta de marco atingido
  deadlineAlert?: DeadlineAlert;  // Alerta de prazo
}

export interface MilestoneAlert {
  type: "milestone";
  milestone: number; // 20, 50, 80, 100
  message: string;
}

export interface DeadlineAlert {
  type: "deadline";
  urgency: "warning" | "critical" | "expired";
  message: string;
}

export interface GetGoalsResult {
  success: boolean;
  goals?: GoalWithProgress[];
  error?: string;
}

export interface SetGoalResult {
  success: boolean;
  goal?: GoalWithProgress;
  error?: string;
}

export interface DeleteGoalResult {
  success: boolean;
  error?: string;
}

// ========== HELPERS ==========

// Obter o intervalo de datas e fim do período para o tipo de meta
function getDateRangeAndEnd(type: string): { start: Date; end: Date; periodEnd: Date } {
  const now = new Date();
  
  if (type === "WEEKLY") {
    // Início da semana (domingo) até agora
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    
    // Fim da semana (sábado às 23:59:59)
    const periodEnd = new Date(start);
    periodEnd.setDate(start.getDate() + 6);
    periodEnd.setHours(23, 59, 59, 999);
    
    return { start, end: now, periodEnd };
  } else {
    // Início do mês até agora
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    
    // Fim do mês
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    periodEnd.setHours(23, 59, 59, 999);
    
    return { start, end: now, periodEnd };
  }
}

// Calcular dias restantes até o fim do período
function getDaysRemaining(periodEnd: Date): number {
  const now = new Date();
  const diffMs = periodEnd.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// Verificar alertas de marco (20%, 50%, 80%, 100%)
function checkMilestoneAlert(progressPercent: number): MilestoneAlert | undefined {
  // Retorna alerta apenas quando está exatamente no marco ou muito próximo
  const milestones = [
    { threshold: 100, message: "Parabéns! Você atingiu sua meta!" },
    { threshold: 80, message: "Excelente! Você está a 80% da sua meta!" },
    { threshold: 50, message: "Ótimo progresso! Metade da meta concluída!" },
    { threshold: 20, message: "Bom começo! 20% da meta alcançado!" },
  ];

  for (const m of milestones) {
    // Verifica se está no intervalo do marco (ex: 80-84% para marco de 80%)
    if (progressPercent >= m.threshold && progressPercent < m.threshold + 5) {
      return {
        type: "milestone",
        milestone: m.threshold,
        message: m.message,
      };
    }
  }

  // Caso especial: 100% ou mais
  if (progressPercent >= 100) {
    return {
      type: "milestone",
      milestone: 100,
      message: "Parabéns! Você atingiu sua meta!",
    };
  }

  return undefined;
}

// Verificar alertas de prazo
function checkDeadlineAlert(type: string, daysRemaining: number, progressPercent: number): DeadlineAlert | undefined {
  // Se já atingiu a meta, não precisa de alerta de prazo
  if (progressPercent >= 100) {
    return undefined;
  }

  if (type === "WEEKLY") {
    // Alerta quando faltam 2 dias ou menos para meta semanal
    if (daysRemaining <= 0) {
      return {
        type: "deadline",
        urgency: "expired",
        message: "O período semanal terminou!",
      };
    } else if (daysRemaining <= 2) {
      return {
        type: "deadline",
        urgency: daysRemaining === 1 ? "critical" : "warning",
        message: `Faltam ${daysRemaining} dia${daysRemaining > 1 ? 's' : ''} para o fim da semana!`,
      };
    }
  } else {
    // Alerta quando falta 1 semana ou menos para meta mensal
    if (daysRemaining <= 0) {
      return {
        type: "deadline",
        urgency: "expired",
        message: "O período mensal terminou!",
      };
    } else if (daysRemaining <= 7) {
      return {
        type: "deadline",
        urgency: daysRemaining <= 3 ? "critical" : "warning",
        message: `Faltam ${daysRemaining} dia${daysRemaining > 1 ? 's' : ''} para o fim do mês!`,
      };
    }
  }

  return undefined;
}

// ========== BUSCAR TODAS AS METAS ==========
export async function getGoals(): Promise<GetGoalsResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    // Buscar usuário no banco
    const user = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { id: true },
    });

    if (!user) {
      return { success: false, error: "Usuário não encontrado" };
    }

    // Buscar todas as metas do usuário
    const goals = await prisma.userGoal.findMany({
      where: { userId: user.id },
      orderBy: { type: 'asc' }, // MONTHLY primeiro, depois WEEKLY
    });

    if (goals.length === 0) {
      return { success: true, goals: [] };
    }

    // Calcular progresso para cada meta
    const goalsWithProgress: GoalWithProgress[] = await Promise.all(
      goals.map(async (goal) => {
        const { start, periodEnd } = getDateRangeAndEnd(goal.type);
        
        const evolutionsCount = await prisma.evolution.count({
          where: {
            patient: {
              userId: user.id,
            },
            createdAt: {
              gte: start,
              lte: new Date(),
            },
          },
        });

        const progressPercent = Math.min(100, Math.round((evolutionsCount / goal.target) * 100));
        const daysRemaining = getDaysRemaining(periodEnd);

        return {
          goal: {
            id: goal.id,
            type: goal.type,
            target: goal.target,
            createdAt: goal.createdAt,
            updatedAt: goal.updatedAt,
          },
          currentProgress: evolutionsCount,
          progressPercent,
          daysRemaining,
          periodEndDate: periodEnd,
          milestoneAlert: checkMilestoneAlert(progressPercent),
          deadlineAlert: checkDeadlineAlert(goal.type, daysRemaining, progressPercent),
        };
      })
    );

    return { success: true, goals: goalsWithProgress };
  } catch (error) {
    console.error("Erro ao buscar metas:", error);
    return { success: false, error: "Erro ao carregar metas" };
  }
}

// ========== BUSCAR META POR TIPO (legacy compatibility) ==========
export async function getGoal(): Promise<{
  success: boolean;
  goal?: UserGoalData | null;
  currentProgress?: number;
  error?: string;
}> {
  const result = await getGoals();
  if (!result.success) {
    return { success: false, error: result.error };
  }
  
  if (!result.goals || result.goals.length === 0) {
    return { success: true, goal: null, currentProgress: 0 };
  }

  // Retorna a primeira meta (para compatibilidade)
  const first = result.goals[0];
  return {
    success: true,
    goal: first.goal,
    currentProgress: first.currentProgress,
  };
}

// ========== DEFINIR/ATUALIZAR META POR TIPO ==========
export async function setGoal(target: number, type: string = "MONTHLY"): Promise<SetGoalResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    // Validar parâmetros
    if (target < 1 || target > 9999) {
      return { success: false, error: "Meta deve ser entre 1 e 9999" };
    }

    if (!["MONTHLY", "WEEKLY"].includes(type)) {
      return { success: false, error: "Tipo de meta inválido" };
    }

    // Buscar usuário no banco
    const user = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { id: true },
    });

    if (!user) {
      return { success: false, error: "Usuário não encontrado" };
    }

    // Verificar se já existe uma meta desse tipo para o usuário
    const existingGoal = await prisma.userGoal.findFirst({
      where: {
        userId: user.id,
        type: type,
      },
    });

    let goal;
    if (existingGoal) {
      // Atualizar meta existente
      goal = await prisma.userGoal.update({
        where: { id: existingGoal.id },
        data: { target },
      });
    } else {
      // Criar nova meta
      goal = await prisma.userGoal.create({
        data: {
          userId: user.id,
          target,
          type,
        },
      });
    }

    // Calcular dados adicionais
    const { start, periodEnd } = getDateRangeAndEnd(type);
    
    const evolutionsCount = await prisma.evolution.count({
      where: {
        patient: {
          userId: user.id,
        },
        createdAt: {
          gte: start,
          lte: new Date(),
        },
      },
    });

    const progressPercent = Math.min(100, Math.round((evolutionsCount / target) * 100));
    const daysRemaining = getDaysRemaining(periodEnd);

    revalidatePath("/dashboard/stats");

    return {
      success: true,
      goal: {
        goal: {
          id: goal.id,
          type: goal.type,
          target: goal.target,
          createdAt: goal.createdAt,
          updatedAt: goal.updatedAt,
        },
        currentProgress: evolutionsCount,
        progressPercent,
        daysRemaining,
        periodEndDate: periodEnd,
        milestoneAlert: checkMilestoneAlert(progressPercent),
        deadlineAlert: checkDeadlineAlert(type, daysRemaining, progressPercent),
      },
    };
  } catch (error) {
    console.error("Erro ao definir meta:", error);
    return { success: false, error: "Erro ao salvar meta" };
  }
}

// ========== REMOVER META POR TIPO ==========
export async function deleteGoalByType(type: string): Promise<DeleteGoalResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    if (!["MONTHLY", "WEEKLY"].includes(type)) {
      return { success: false, error: "Tipo de meta inválido" };
    }

    // Buscar usuário no banco
    const user = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { id: true },
    });

    if (!user) {
      return { success: false, error: "Usuário não encontrado" };
    }

    // Deletar meta específica por tipo
    await prisma.userGoal.deleteMany({
      where: { 
        userId: user.id,
        type: type,
      },
    });

    revalidatePath("/dashboard/stats");

    return { success: true };
  } catch (error) {
    console.error("Erro ao remover meta:", error);
    return { success: false, error: "Erro ao remover meta" };
  }
}

// ========== REMOVER TODAS AS METAS (legacy) ==========
export async function deleteGoal(): Promise<DeleteGoalResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    // Buscar usuário no banco
    const user = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { id: true },
    });

    if (!user) {
      return { success: false, error: "Usuário não encontrado" };
    }

    // Deletar todas as metas do usuário
    await prisma.userGoal.deleteMany({
      where: { userId: user.id },
    });

    revalidatePath("/dashboard/stats");

    return { success: true };
  } catch (error) {
    console.error("Erro ao remover metas:", error);
    return { success: false, error: "Erro ao remover metas" };
  }
}
