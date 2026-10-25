"use server";

import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { hasAdminRole } from "@/lib/plan-limits";
import { getClinicalProfileSnapshot } from "@/lib/clinical-chat/clinical-profile-snapshot";

// ============ TIPOS PARA CLINICAL STATS ============

export interface TagCount {
  tag: string;
  count: number;
}

export interface ClinicalStatsResult {
  success: boolean;
  data?: {
    topTags: TagCount[];
    totalTags: number;
    mostFrequentTag: string | null;
    monthTagCount?: number;
  };
  error?: string;
}

// ============ TIPOS PARA ESTATÍSTICAS GERAIS ============

// Tipos para estatísticas
export interface DailyStats {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface PeriodStats {
  lastWeek: number;
  lastMonth: number;
  lastQuarter: number;
  lastSemester: number;
  lastYear: number;
  allTime: number;
}

export interface AverageStats {
  perDay: number;
  perWeek: number;
  perMonth: number;
}

export interface StreakStats {
  currentStreak: number; // dias consecutivos com atendimento
  longestStreak: number;
  lastActivityDate: string | null;
}

export interface AchievementData {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlockedAt?: string;
  progress?: number; // 0-100
  target?: number;
  current?: number;
}

export interface DetailedStats {
  // Totais
  totalEvolutions: number;
  totalPatients: number;
  
  // Por período
  periodStats: PeriodStats;
  
  // Médias
  averages: AverageStats;
  
  // Streaks
  streaks: StreakStats;
  
  // Dados para gráfico (últimos 30 dias)
  dailyData: DailyStats[];
  
  // Dados para gráfico semanal (últimas 12 semanas)
  weeklyData: { week: string; count: number }[];
  
  // Dados para gráfico mensal (últimos 12 meses)
  monthlyData: { month: string; count: number }[];
  
  // Conquistas
  achievements: AchievementData[];
  
  // Primeiro atendimento
  firstEvolutionDate: string | null;
  
  // Dias desde o registro
  daysSinceRegistration: number;
}

export interface GetDetailedStatsResult {
  success: boolean;
  stats?: DetailedStats;
  error?: string;
}

// Helper: Calcular início de períodos
function getDateRanges() {
  const now = new Date();
  
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 7);
  startOfWeek.setHours(0, 0, 0, 0);
  
  const startOfMonth = new Date(now);
  startOfMonth.setDate(now.getDate() - 30);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const startOfQuarter = new Date(now);
  startOfQuarter.setDate(now.getDate() - 90);
  startOfQuarter.setHours(0, 0, 0, 0);
  
  const startOfSemester = new Date(now);
  startOfSemester.setDate(now.getDate() - 180);
  startOfSemester.setHours(0, 0, 0, 0);
  
  const startOfYear = new Date(now);
  startOfYear.setDate(now.getDate() - 365);
  startOfYear.setHours(0, 0, 0, 0);
  
  return {
    now,
    startOfWeek,
    startOfMonth,
    startOfQuarter,
    startOfSemester,
    startOfYear,
  };
}

// Helper: Calcular streak
function calculateStreak(evolutions: { createdAt: Date }[]): StreakStats {
  if (evolutions.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastActivityDate: null };
  }
  
  // Ordenar por data (mais recente primeiro)
  const sorted = [...evolutions].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  
  const lastActivityDate = sorted[0].createdAt.toISOString().split('T')[0];
  
  // Agrupar por dia
  const daySet = new Set<string>();
  sorted.forEach(e => {
    daySet.add(new Date(e.createdAt).toISOString().split('T')[0]);
  });
  
  const uniqueDays = Array.from(daySet).sort().reverse();
  
  // Calcular streak atual
  let currentStreak = 0;
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  // Verificar se há atividade hoje ou ontem para começar a contar
  if (uniqueDays[0] === today || uniqueDays[0] === yesterday) {
    currentStreak = 1;
    const expectedDate = new Date(uniqueDays[0]);
    
    for (let i = 1; i < uniqueDays.length; i++) {
      expectedDate.setDate(expectedDate.getDate() - 1);
      const expectedStr = expectedDate.toISOString().split('T')[0];
      
      if (uniqueDays[i] === expectedStr) {
        currentStreak++;
      } else {
        break;
      }
    }
  }
  
  // Calcular maior streak de todos os tempos
  let longestStreak = 1;
  let tempStreak = 1;
  
  for (let i = 1; i < uniqueDays.length; i++) {
    const current = new Date(uniqueDays[i - 1]);
    const prev = new Date(uniqueDays[i]);
    const diffDays = Math.floor((current.getTime() - prev.getTime()) / 86400000);
    
    if (diffDays === 1) {
      tempStreak++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else {
      tempStreak = 1;
    }
  }
  
  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
    lastActivityDate,
  };
}

// Helper: Calcular conquistas
function calculateAchievements(
  totalEvolutions: number,
  totalPatients: number,
  streaks: StreakStats,
  daysSinceRegistration: number
): AchievementData[] {
  const achievements: AchievementData[] = [];
  
  // Conquistas de quantidade de evoluções
  const evolutionMilestones = [
    { id: 'evo_1', count: 1, title: 'Primeira Evolução', desc: 'Criou sua primeira evolução', icon: '🎯' },
    { id: 'evo_10', count: 10, title: 'Iniciante', desc: 'Completou 10 evoluções', icon: '⭐' },
    { id: 'evo_50', count: 50, title: 'Praticante', desc: 'Completou 50 evoluções', icon: '🌟' },
    { id: 'evo_100', count: 100, title: 'Experiente', desc: 'Completou 100 evoluções', icon: '💫' },
    { id: 'evo_250', count: 250, title: 'Veterano', desc: 'Completou 250 evoluções', icon: '🏆' },
    { id: 'evo_500', count: 500, title: 'Mestre', desc: 'Completou 500 evoluções', icon: '👑' },
    { id: 'evo_1000', count: 1000, title: 'Lenda', desc: 'Completou 1000 evoluções', icon: '🔥' },
  ];
  
  evolutionMilestones.forEach(m => {
    const unlocked = totalEvolutions >= m.count;
    const nextMilestone = evolutionMilestones.find(x => x.count > totalEvolutions);
    
    achievements.push({
      id: m.id,
      title: m.title,
      description: m.desc,
      icon: m.icon,
      unlocked,
      progress: unlocked ? 100 : Math.min(99, Math.round((totalEvolutions / m.count) * 100)),
      target: m.count,
      current: totalEvolutions,
    });
  });
  
  // Conquistas de pacientes
  const patientMilestones = [
    { id: 'pat_5', count: 5, title: 'Consultório', desc: 'Atendeu 5 pacientes diferentes', icon: '👥' },
    { id: 'pat_25', count: 25, title: 'Clínica', desc: 'Atendeu 25 pacientes diferentes', icon: '🏥' },
    { id: 'pat_100', count: 100, title: 'Hospital', desc: 'Atendeu 100 pacientes diferentes', icon: '🏨' },
  ];
  
  patientMilestones.forEach(m => {
    achievements.push({
      id: m.id,
      title: m.title,
      description: m.desc,
      icon: m.icon,
      unlocked: totalPatients >= m.count,
      progress: Math.min(100, Math.round((totalPatients / m.count) * 100)),
      target: m.count,
      current: totalPatients,
    });
  });
  
  // Conquistas de streak
  const streakMilestones = [
    { id: 'streak_3', count: 3, title: 'Consistente', desc: '3 dias consecutivos', icon: '🔥' },
    { id: 'streak_7', count: 7, title: 'Semana Perfeita', desc: '7 dias consecutivos', icon: '📅' },
    { id: 'streak_30', count: 30, title: 'Mês de Foco', desc: '30 dias consecutivos', icon: '📆' },
  ];
  
  streakMilestones.forEach(m => {
    achievements.push({
      id: m.id,
      title: m.title,
      description: m.desc,
      icon: m.icon,
      unlocked: streaks.longestStreak >= m.count,
      progress: Math.min(100, Math.round((streaks.currentStreak / m.count) * 100)),
      target: m.count,
      current: streaks.currentStreak,
    });
  });
  
  return achievements;
}

// Obter estatísticas detalhadas
export async function getDetailedStats(): Promise<GetDetailedStatsResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    // Log para debug em produção
    if (process.env.NODE_ENV === 'production') {
      console.log("[getDetailedStats] Auth check:", { 
        hasUser: !!authUser, 
        email: authUser?.email || 'null',
        error: authError?.message || 'none' 
      });
    }
    
    if (authError || !authUser?.email) {
      console.warn("[getDetailedStats] Autenticação falhou:", authError?.message || "Sem email");
      return { success: false, error: "Usuário não autenticado" };
    }

    const user = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { id: true, createdAt: true },
    });

    if (!user) {
      return { success: false, error: "Usuário não encontrado" };
    }

    const ranges = getDateRanges();

    // Contar pacientes
    const totalPatients = await prisma.patient.count({
      where: { userId: user.id },
    });

    // Buscar todas as evoluções do usuário (através dos pacientes)
    const evolutions = await prisma.evolution.findMany({
      where: { 
        patient: {
          userId: user.id
        }
      },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const totalEvolutions = evolutions.length;

    // Estatísticas por período
    const periodStats: PeriodStats = {
      lastWeek: evolutions.filter(e => new Date(e.createdAt) >= ranges.startOfWeek).length,
      lastMonth: evolutions.filter(e => new Date(e.createdAt) >= ranges.startOfMonth).length,
      lastQuarter: evolutions.filter(e => new Date(e.createdAt) >= ranges.startOfQuarter).length,
      lastSemester: evolutions.filter(e => new Date(e.createdAt) >= ranges.startOfSemester).length,
      lastYear: evolutions.filter(e => new Date(e.createdAt) >= ranges.startOfYear).length,
      allTime: totalEvolutions,
    };

    // Calcular dias desde registro
    const daysSinceRegistration = Math.floor(
      (Date.now() - new Date(user.createdAt).getTime()) / 86400000
    ) + 1;

    // Médias
    const averages: AverageStats = {
      perDay: daysSinceRegistration > 0 ? Math.round((totalEvolutions / daysSinceRegistration) * 100) / 100 : 0,
      perWeek: daysSinceRegistration >= 7 ? Math.round((periodStats.lastMonth / 4) * 100) / 100 : periodStats.lastWeek,
      perMonth: daysSinceRegistration >= 30 ? Math.round((periodStats.lastQuarter / 3) * 100) / 100 : periodStats.lastMonth,
    };

    // Streaks
    const streaks = calculateStreak(evolutions);

    // Dados diários (últimos 30 dias)
    const dailyData: DailyStats[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const count = evolutions.filter(e => 
        new Date(e.createdAt).toISOString().split('T')[0] === dateStr
      ).length;
      
      dailyData.push({ date: dateStr, count });
    }

    // Dados semanais (últimas 12 semanas)
    const weeklyData: { week: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i * 7) - weekStart.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      
      const count = evolutions.filter(e => {
        const d = new Date(e.createdAt);
        return d >= weekStart && d <= weekEnd;
      }).length;
      
      const weekLabel = `${weekStart.getDate()}/${weekStart.getMonth() + 1}`;
      weeklyData.push({ week: weekLabel, count });
    }

    // Dados mensais (últimos 12 meses)
    const monthlyData: { month: string; count: number }[] = [];
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    
    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const year = date.getFullYear();
      const month = date.getMonth();
      
      const count = evolutions.filter(e => {
        const d = new Date(e.createdAt);
        return d.getMonth() === month && d.getFullYear() === year;
      }).length;
      
      monthlyData.push({ 
        month: `${monthNames[month]}/${year.toString().slice(-2)}`, 
        count 
      });
    }

    // Conquistas
    const achievements = calculateAchievements(
      totalEvolutions,
      totalPatients,
      streaks,
      daysSinceRegistration
    );

    // Primeira evolução
    const firstEvolution = evolutions.length > 0 
      ? evolutions[evolutions.length - 1].createdAt.toISOString().split('T')[0]
      : null;

    return {
      success: true,
      stats: {
        totalEvolutions,
        totalPatients,
        periodStats,
        averages,
        streaks,
        dailyData,
        weeklyData,
        monthlyData,
        achievements,
        firstEvolutionDate: firstEvolution,
        daysSinceRegistration,
      },
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas:", error);
    return { success: false, error: "Erro ao carregar estatísticas" };
  }
}

// ============ FUNÇÕES DE ADMINISTRAÇÃO ============

interface FixResult {
  success: boolean;
  message: string;
  details?: {
    totalPatients: number;
    patientsFixed: number;
    patientsNotFixed: number;
    userMappings: { email: string; patients: number }[];
  };
}

/**
 * CORREÇÃO INTELIGENTE: Identifica o verdadeiro dono de cada paciente
 * baseado no email contido no pdfUrl das evoluções
 * 
 * O pdfUrl tem formato: userId_email_normalizado/timestamp-patientName.pdf
 * Exemplo: joao_exemplo_com/1234567890-Maria.pdf
 */
export async function fixPatientOwnershipSmart(): Promise<FixResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser?.email) {
      return { success: false, message: "Usuário não autenticado" };
    }

    // Verificar se é admin
    const adminUser = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { id: true, role: true },
    });

    if (!adminUser || !hasAdminRole(adminUser.role, authUser.email)) {
      return { success: false, message: "Apenas administradores podem executar esta ação" };
    }

    // Buscar todos os usuários
    const allUsers = await prisma.user.findMany({
      select: { id: true, email: true },
    });

    // Criar mapeamento de email normalizado -> userId
    const emailToUserId: Record<string, string> = {};
    for (const user of allUsers) {
      if (user.email) {
        // Normalizar email da mesma forma que é feito no pdfUrl
        const normalizedEmail = user.email.replace(/[^a-zA-Z0-9]/g, '_');
        emailToUserId[normalizedEmail.toLowerCase()] = user.id;
      }
    }

    console.log("[FIX] Mapeamento de emails:", Object.keys(emailToUserId));

    // Primeiro, desvincular TODOS os pacientes
    await prisma.patient.updateMany({
      data: { userId: null },
    });
    console.log("[FIX] Todos os pacientes desvinculados");

    // Buscar todas as evoluções com pdfUrl
    const evolutions = await prisma.evolution.findMany({
      where: { pdfUrl: { not: null } },
      select: { 
        id: true, 
        pdfUrl: true, 
        patientId: true,
        patient: { select: { id: true, name: true } }
      },
    });

    console.log(`[FIX] ${evolutions.length} evoluções com pdfUrl encontradas`);

    // Mapear patientId -> userId (baseado no pdfUrl)
    const patientToUser: Record<string, string> = {};
    const userPatientCount: Record<string, number> = {};

    for (const evo of evolutions) {
      if (!evo.pdfUrl) continue;

      // Extrair o email normalizado do pdfUrl
      // Formato: https://...supabase.../evolutions/email_normalizado/timestamp-nome.pdf
      const urlParts = evo.pdfUrl.split('/');
      const emailPart = urlParts.find((part, index) => {
        // O email está após "evolutions" e antes do arquivo
        const prevPart = urlParts[index - 1];
        return prevPart === 'evolutions' || (part.includes('_') && !part.includes('.pdf'));
      });

      if (emailPart && !emailPart.includes('.pdf')) {
        const normalizedEmail = emailPart.toLowerCase();
        const userId = emailToUserId[normalizedEmail];

        if (userId && evo.patientId) {
          // Só atribuir se ainda não foi atribuído (primeira evolução define o dono)
          if (!patientToUser[evo.patientId]) {
            patientToUser[evo.patientId] = userId;
            userPatientCount[userId] = (userPatientCount[userId] || 0) + 1;
            console.log(`[FIX] Paciente ${evo.patient?.name} -> User ${normalizedEmail}`);
          }
        }
      }
    }

    // Aplicar as correções
    let patientsFixed = 0;
    for (const [patientId, userId] of Object.entries(patientToUser)) {
      await prisma.patient.update({
        where: { id: patientId },
        data: { userId: userId },
      });
      patientsFixed++;
    }

    // Contar pacientes não corrigidos
    const totalPatients = await prisma.patient.count();
    const patientsNotFixed = totalPatients - patientsFixed;

    // Criar resumo por usuário
    const userMappings: { email: string; patients: number }[] = [];
    for (const user of allUsers) {
      if (user.email) {
        const count = await prisma.patient.count({ where: { userId: user.id } });
        if (count > 0) {
          userMappings.push({ email: user.email, patients: count });
        }
      }
    }

    console.log("[FIX] Correção concluída:", {
      totalPatients,
      patientsFixed,
      patientsNotFixed,
      userMappings
    });

    return {
      success: true,
      message: `Correção concluída! ${patientsFixed} pacientes vinculados corretamente.`,
      details: {
        totalPatients,
        patientsFixed,
        patientsNotFixed,
        userMappings
      }
    };
  } catch (error) {
    console.error("Erro ao corrigir ownership:", error);
    return { success: false, message: `Erro ao corrigir: ${error instanceof Error ? error.message : 'Desconhecido'}` };
  }
}

// ============ CLINICAL STATS (CLINICAL TAGGER) ============
// Usa o sistema unificado de taxonomia clínica com termos guarda-chuva

/**
 * Busca estatísticas clínicas do Perfil Clínico (ramos guarda-chuva).
 * Delega à mesma agregação usada pelas Indicações da Ester.
 */
export async function getClinicalStats(): Promise<ClinicalStatsResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    const user = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { id: true },
    });

    if (!user) {
      return { success: false, error: "Usuário não encontrado" };
    }

    const snapshot = await getClinicalProfileSnapshot(user.id);

    return {
      success: true,
      data: {
        topTags: snapshot.topTags,
        totalTags: snapshot.totalTags,
        mostFrequentTag: snapshot.mostFrequentTag,
        monthTagCount: snapshot.monthTagCount,
      },
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas clínicas:", error);
    return { success: false, error: "Erro ao carregar estatísticas clínicas" };
  }
}
