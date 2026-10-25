/**
 * Rotas exibidas no menu rápido (ícone ☰) em todas as páginas do dashboard,
 * exceto na raiz `/dashboard` — ver `DashboardSubnavChrome`.
 *
 * A primeira entrada costuma ser o **Menu Principal** (`/dashboard`). O botão
 * **Sair** é renderizado à parte no componente do menu.
 *
 * **Ao adicionar uma nova página “tipo card” do dashboard:** inclua aqui um
 * objeto com `href`, `title`, `description` e `icon`. O menu lê sempre este
 * array; não há outra lista a manter sincronizada.
 *
 * Ícones: chaves em `DashboardNavIcon` — mapeadas em `DashboardPagesMenu`.
 */
export type DashboardNavIcon =
  | "layoutDashboard"
  | "mic"
  | "users"
  | "calendar"
  | "wallet"
  | "fileStack"
  | "activity"
  | "user"
  | "message"
  | "bot"
  | "sparkles"
  | "lightbulb"
  | "zap"
  | "link";

export type DashboardNavPageDef = {
  href: string;
  title: string;
  /** Título longo na barra superior; se omitido, usa `title`. */
  headerTitle?: string;
  description: string;
  icon: DashboardNavIcon;
};

export const DASHBOARD_HOME_HREF = "/dashboard" as const;
export const DASHBOARD_HOME_TITLE = "Menu Principal" as const;

/** Rótulos de navegação para a raiz `/dashboard` (UI). */
export const DASHBOARD_HOME_LINK_LABELS = {
  voltarAo: `Voltar ao ${DASHBOARD_HOME_TITLE}`,
  voltarPara: `Voltar para o ${DASHBOARD_HOME_TITLE}`,
  irPara: `Ir para o ${DASHBOARD_HOME_TITLE}`,
} as const;

export const DASHBOARD_NAV_PAGES: readonly DashboardNavPageDef[] = [
  {
    href: DASHBOARD_HOME_HREF,
    title: DASHBOARD_HOME_TITLE,
    description: "Atalhos da operação",
    icon: "layoutDashboard",
  },
  {
    href: "/dashboard/painel",
    title: "Painel do Dia",
    description: "Coletas, entregas e baixa em um clique",
    icon: "calendar",
  },
  {
    href: "/dashboard/dentistas",
    title: "Clientes",
    description: "Endereços dos clientes e entregadores",
    icon: "users",
  },
  {
    href: "/dashboard/agenda",
    title: "Agenda",
    description: "Coletas e entregas na semana",
    icon: "calendar",
  },
  {
    href: "/dashboard/finances",
    title: "Financeiro",
    description: "Caixa e serviços de prótese",
    icon: "wallet",
  },
  {
    href: "/dashboard/profile",
    title: "Meu Perfil",
    description: "Dados da conta e equipe do laboratório",
    icon: "user",
  },
];

/** Destaque do item ativo no menu (path exato ou secção dinâmica). */
export function isDashboardNavPageActive(pathname: string, item: DashboardNavPageDef): boolean {
  if (item.href === "/dashboard") {
    return pathname === "/dashboard" || pathname === "/dashboard/";
  }
  if (item.href === "/dashboard/patients") {
    if (pathname === "/dashboard/patients") return true;
    return /^\/dashboard\/patients\/[^/]+$/.test(pathname);
  }
  return pathname === item.href;
}

/** Ficha individual: `/dashboard/patients/:id` (sem sub-rotas extras). */
export function isPatientDetailPath(pathname: string): boolean {
  return /^\/dashboard\/patients\/[^/]+$/.test(pathname);
}

/**
 * Destino explícito do botão Voltar do chrome (quando `router.back()` seria ambíguo).
 * Ex.: ficha do paciente → sempre lista de Pacientes (não o Menu Principal).
 */
export function getDashboardBackTarget(
  pathname: string,
): { href: string; label: string } | null {
  if (isPatientDetailPath(pathname)) {
    return { href: "/dashboard/patients", label: "Voltar para Pacientes" };
  }
  return null;
}

/** Título da secção ativa para o chrome do dashboard (barra superior). */
export function getDashboardNavPageTitle(pathname: string): string {
  const match = DASHBOARD_NAV_PAGES.find((item) => isDashboardNavPageActive(pathname, item));
  return match?.headerTitle ?? match?.title ?? DASHBOARD_HOME_TITLE;
}

export function isEsterClinicalChatPath(pathname: string): boolean {
  return pathname === "/dashboard/clinical-chat";
}
