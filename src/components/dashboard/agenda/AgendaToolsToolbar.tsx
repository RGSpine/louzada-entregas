"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  CalendarDays,
  Layers,
  LayoutGrid,
  Loader2,
  Mic,
  MessageSquareText,
  Plus,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClinicalCalmModal } from "@/components/ui/ClinicalCalmModal";
import { GoogleMarkIcon } from "@/components/icons/GoogleMarkIcon";
import { AgendaGoogleCalendarPanel } from "@/components/dashboard/AgendaGoogleCalendarPanel";
import { AgendaIntakePanel } from "@/components/dashboard/AgendaIntakePanel";
import { AgendaReportsPanel } from "@/components/dashboard/AgendaReportsPanel";
import { AgendaFinanceProjectionSummary } from "@/components/dashboard/AgendaFinanceProjectionSummary";
import { AgendaTreatmentPlanBatchPanel } from "@/components/dashboard/AgendaTreatmentPlanBatchPanel";
import { PremiumFeatureTeaserCard } from "@/components/premium/PremiumFeatureTeaserCard";
import {
  agendaTopOutlineBtnClass,
  AgendaMotionButton,
} from "@/components/dashboard/agenda-card-actions";
import { getAgendaGoogleCalendarStatus } from "@/app/actions/google-calendar";
import type { PlanType } from "@/lib/plan-limits";
import type { AgendaFinanceProjection } from "@/lib/agenda-finance-projection";
import type { PatientOption } from "@/components/dashboard/agenda/AgendaManualBookingForm";
import { cn } from "@/lib/utils";

export const AGENDA_MODAL_Z_INDEX_CLASS = "z-[200]";

type ToolId = "google" | "intake" | "reports" | "finance" | "batch";

type AgendaToolsContextValue = {
  openTool: (id: ToolId) => void;
  onNewManual: () => void;
  outlineBtnClass: string;
  canUseGoogleCalendar: boolean;
};

const AgendaToolsContext = createContext<AgendaToolsContextValue | null>(null);

function useAgendaTools() {
  const ctx = useContext(AgendaToolsContext);
  if (!ctx) throw new Error("AgendaToolsColumn deve ficar dentro de AgendaToolsShell");
  return ctx;
}

type ShellProps = {
  children: ReactNode;
  outlineBtnClass?: string;
  onGoogleSynced: () => void;
  onBooked: () => void;
  onBatchGenerated: () => void;
  onNewManual: () => void;
  patients: PatientOption[];
  timezone: string;
  currentPlan: PlanType;
  maxAudioSeconds: number;
  canUseAgendaIntake: boolean | null;
  canUseAgendaReports: boolean | null;
  canUseAgendaFinanceProjection: boolean | null;
  financeProjection: AgendaFinanceProjection;
  financeLoading: boolean;
  /** yyyy-MM-dd — deep-link Agenda → financeiro da semana */
  weekStartIso?: string | null;
};

function ToolButton({
  label,
  onClick,
  children,
  className,
  variant = "default",
  compact = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "primary";
  compact?: boolean;
}) {
  return (
    <AgendaMotionButton
      className={cn(
        compact
          ? "h-auto min-h-8 justify-center gap-1 px-1.5 py-1.5 text-center"
          : "h-auto w-full justify-start gap-2 px-3 py-2.5 text-left",
        variant === "primary" ? "bg-primary hover:bg-primary/90" : className,
      )}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
      <span className={cn("leading-tight", compact ? "text-[10px]" : "text-xs leading-snug sm:text-sm")}>
        {label}
      </span>
    </AgendaMotionButton>
  );
}

export function AgendaToolsShell({
  children,
  outlineBtnClass = agendaTopOutlineBtnClass,
  onGoogleSynced,
  onBooked,
  onBatchGenerated,
  onNewManual,
  patients,
  timezone,
  currentPlan,
  maxAudioSeconds,
  canUseAgendaIntake,
  canUseAgendaReports,
  canUseAgendaFinanceProjection,
  financeProjection,
  financeLoading,
  weekStartIso = null,
}: ShellProps) {
  const [openToolId, setOpenToolId] = useState<ToolId | null>(null);
  const [canUseGoogleCalendar, setCanUseGoogleCalendar] = useState(false);

  useEffect(() => {
    void getAgendaGoogleCalendarStatus().then((res) => {
      setCanUseGoogleCalendar(res.success === true && res.integrationEnabled === true);
    });
  }, []);

  const close = () => setOpenToolId(null);

  const openTool = useCallback(
    (id: ToolId) => {
      if (id === "google" && !canUseGoogleCalendar) return;
      setOpenToolId(id);
    },
    [canUseGoogleCalendar],
  );

  const ctx = useMemo<AgendaToolsContextValue>(
    () => ({
      openTool,
      onNewManual,
      outlineBtnClass,
      canUseGoogleCalendar,
    }),
    [openTool, onNewManual, outlineBtnClass, canUseGoogleCalendar],
  );

  return (
    <AgendaToolsContext.Provider value={ctx}>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      {canUseGoogleCalendar ? (
        <ClinicalCalmModal
          open={openToolId === "google"}
          onClose={close}
          className="max-w-2xl"
          ariaLabel="Integrar com o Google Agenda"
          zIndexClass={AGENDA_MODAL_Z_INDEX_CLASS}
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <CalendarDays className="h-5 w-5" />
              Integrar com o Google Agenda
            </h2>
            <Button type="button" variant="ghost" size="icon" onClick={close} aria-label="Fechar">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <AgendaGoogleCalendarPanel outlineBtnClass={outlineBtnClass} onSynced={onGoogleSynced} />
        </ClinicalCalmModal>
      ) : null}

      <ClinicalCalmModal
        open={openToolId === "intake"}
        onClose={close}
        className="max-w-lg"
        ariaLabel="Agenda por áudio"
        zIndexClass={AGENDA_MODAL_Z_INDEX_CLASS}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Agenda por áudio</h2>
          <Button type="button" variant="ghost" size="icon" onClick={close} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <PremiumFeatureTeaserCard featureId="voice-agenda" allowed={canUseAgendaIntake === true}>
          <AgendaIntakePanel
            onBooked={() => {
              onBooked();
              close();
            }}
            currentPlan={currentPlan}
            maxAudioSeconds={maxAudioSeconds}
          />
        </PremiumFeatureTeaserCard>
      </ClinicalCalmModal>

      <ClinicalCalmModal
        open={openToolId === "reports"}
        onClose={close}
        className="max-w-lg"
        ariaLabel="Relatórios por voz"
        zIndexClass={AGENDA_MODAL_Z_INDEX_CLASS}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Relatórios por voz</h2>
          <Button type="button" variant="ghost" size="icon" onClick={close} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <PremiumFeatureTeaserCard featureId="agenda-reports" allowed={canUseAgendaReports === true}>
          <AgendaReportsPanel outlineBtnClass={outlineBtnClass} currentPlan={currentPlan} maxAudioSeconds={maxAudioSeconds} />
        </PremiumFeatureTeaserCard>
      </ClinicalCalmModal>

      <ClinicalCalmModal
        open={openToolId === "finance"}
        onClose={close}
        className="max-w-md"
        ariaLabel="Projeção financeira"
        zIndexClass={AGENDA_MODAL_Z_INDEX_CLASS}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Projeção financeira</h2>
          <Link href="/dashboard/finances" className="text-xs text-primary hover:underline">
            Abrir financeiro
          </Link>
        </div>
        {financeLoading ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : canUseAgendaFinanceProjection ? (
          <AgendaFinanceProjectionSummary
            projection={financeProjection}
            weekStartIso={weekStartIso}
            compact
            embedded
            hideHeader
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Disponível nos planos Profissional e Premium.{" "}
            <Link href="/dashboard/planos" className="text-primary underline">
              Ver planos
            </Link>
          </p>
        )}
      </ClinicalCalmModal>

      <ClinicalCalmModal
        open={openToolId === "batch"}
        onClose={close}
        className="max-w-lg"
        ariaLabel="Gerar horários de pacote"
        zIndexClass={AGENDA_MODAL_Z_INDEX_CLASS}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Gerar horários de pacote</h2>
          <Button type="button" variant="ghost" size="icon" onClick={close} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <PremiumFeatureTeaserCard featureId="voice-agenda" allowed={canUseAgendaIntake === true}>
          <AgendaTreatmentPlanBatchPanel
            patients={patients}
            timezone={timezone}
            outlineBtnClass={outlineBtnClass}
            onGenerated={() => {
              onBatchGenerated();
              close();
            }}
          />
        </PremiumFeatureTeaserCard>
      </ClinicalCalmModal>
    </AgendaToolsContext.Provider>
  );
}

export function AgendaToolsColumn({
  side,
  compact = false,
}: {
  side: "left" | "right";
  compact?: boolean;
}) {
  const { openTool, onNewManual, outlineBtnClass, canUseGoogleCalendar } = useAgendaTools();

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col",
        compact ? "w-full gap-1" : "w-[min(100%,11.5rem)] gap-2 sm:w-40 lg:w-44 xl:w-48",
      )}
    >
      {side === "left" ? (
        <>
          {canUseGoogleCalendar ? (
            <ToolButton
              label={compact ? "Google" : "Integrar com o Google Agenda"}
              onClick={() => openTool("google")}
              className={outlineBtnClass}
              compact={compact}
            >
              <GoogleMarkIcon className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
            </ToolButton>
          ) : null}

          <ToolButton
            label={compact ? "Áudio" : "Agenda por áudio"}
            onClick={() => openTool("intake")}
            className={outlineBtnClass}
            compact={compact}
          >
            <Mic className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          </ToolButton>

          <ToolButton
            label="Relatórios"
            onClick={() => openTool("reports")}
            className={outlineBtnClass}
            compact={compact}
          >
            <MessageSquareText className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          </ToolButton>
        </>
      ) : (
        <>
          <ToolButton
            label="Financeiro"
            onClick={() => openTool("finance")}
            className={outlineBtnClass}
            compact={compact}
          >
            <Wallet className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          </ToolButton>

          <ToolButton
            label="Pacotes"
            onClick={() => openTool("batch")}
            className={outlineBtnClass}
            compact={compact}
          >
            <Layers className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          </ToolButton>

          <ToolButton
            label={compact ? "Nova" : "Nova marcação"}
            onClick={onNewManual}
            variant="primary"
            compact={compact}
          >
            <Plus className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          </ToolButton>
        </>
      )}
    </div>
  );
}

/** FAB — abre painel com as 6 funções da agenda (mobile e desktop). */
export function AgendaToolsMobileFab() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { openTool, onNewManual, outlineBtnClass, canUseGoogleCalendar } = useAgendaTools();

  const pick = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  const toolItems: Array<{
    label: string;
    icon: React.ReactNode;
    action: () => void;
    primary?: boolean;
  }> = [
    ...(canUseGoogleCalendar
      ? [
          {
            label: "Google Agenda",
            icon: <GoogleMarkIcon className="h-4 w-4 shrink-0" />,
            action: () => openTool("google"),
          },
        ]
      : []),
    {
      label: "Áudio",
      icon: <Mic className="h-4 w-4 shrink-0" />,
      action: () => openTool("intake"),
    },
    {
      label: "Relatórios",
      icon: <MessageSquareText className="h-4 w-4 shrink-0" />,
      action: () => openTool("reports"),
    },
    {
      label: "Financeiro",
      icon: <Wallet className="h-4 w-4 shrink-0" />,
      action: () => openTool("finance"),
    },
    {
      label: "Pacotes",
      icon: <Layers className="h-4 w-4 shrink-0" />,
      action: () => openTool("batch"),
    },
    {
      label: "Nova marcação",
      icon: <Plus className="h-4 w-4 shrink-0" />,
      action: onNewManual,
      primary: true,
    },
  ];

  return (
    <>
      {menuOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px]"
          aria-label="Fechar funções da agenda"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-50 flex flex-col items-end gap-3">
        {menuOpen ? (
          <div className="pointer-events-auto w-[min(calc(100vw-2rem),19rem)] animate-in fade-in slide-in-from-bottom-4 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-elevation-3)] duration-200">
            <p className="mb-2 text-center text-xs font-semibold text-muted-foreground">Funções da agenda</p>
            <div className="grid grid-cols-2 gap-2">
              {toolItems.map((tool) => (
                <Button
                  key={tool.label}
                  type="button"
                  size="sm"
                  variant={tool.primary ? "default" : "default"}
                  className={cn(
                    "h-auto min-h-10 flex-col gap-1 px-2 py-2 text-[10px] leading-tight",
                    tool.primary ? "bg-primary hover:bg-primary/90" : outlineBtnClass,
                  )}
                  onClick={() => pick(tool.action)}
                >
                  {tool.icon}
                  <span>{tool.label}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <Button
          type="button"
          size="lg"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Fechar funções" : "Abrir funções da agenda"}
          className={cn(
            "pointer-events-auto h-14 min-h-14 gap-2 rounded-2xl px-5 shadow-[var(--shadow-elevation-3)]",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "dark:bg-white dark:text-[#0f172a] dark:hover:bg-white/95",
          )}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
          <span className="text-sm font-semibold">{menuOpen ? "Fechar" : "Funções"}</span>
        </Button>
      </div>
    </>
  );
}

/** @deprecated Use AgendaToolsShell + AgendaToolsColumn */
export function AgendaToolsToolbar(props: ShellProps) {
  return (
    <AgendaToolsShell {...props}>
      <div className="flex flex-wrap items-center gap-2">
        <AgendaToolsColumn side="left" />
        <AgendaToolsColumn side="right" />
      </div>
    </AgendaToolsShell>
  );
}
