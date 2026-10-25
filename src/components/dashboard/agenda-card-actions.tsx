"use client";

import type { ComponentProps, ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { Button } from "@/components/ui/button";
import { clinical3DSpring } from "@/design/motion-presets";
import { cn } from "@/lib/utils";

/** Azul + texto branco (claro) · branco + texto escuro (escuro) — padrão onboarding/CTA. */
const agendaDepthColors =
  "bg-primary text-primary-foreground border border-primary/25 " +
  "shadow-[var(--shadow-elevation-1)] hover:bg-primary/90 hover:text-primary-foreground " +
  "hover:shadow-[var(--shadow-elevation-2)] active:scale-[0.98] " +
  "dark:bg-white dark:text-[#0f172a] dark:border-white/30 " +
  "dark:hover:bg-white/95 dark:hover:text-[#0f172a] dark:hover:shadow-[var(--shadow-elevation-2)]";

/**
 * Botões laterais da agenda (Google, áudio, relatórios, etc.).
 */
export const agendaTopOutlineBtnClass =
  `${agendaDepthColors} ` +
  "!inline-flex h-auto min-h-9 w-full min-w-0 shrink items-center justify-center " +
  "!whitespace-normal text-center break-words px-2.5 py-2 text-xs leading-snug font-medium " +
  "transition-[box-shadow,transform] duration-200";

/** Botões de ação nas marcações (evolução, realizada, financeiro). */
export const agendaCardActionBtnClass =
  `${agendaDepthColors} ` +
  "!inline-flex !h-auto min-h-9 w-full max-w-full min-w-0 shrink " +
  "!items-center !justify-center !whitespace-normal overflow-hidden text-center " +
  "px-2 py-1.5 text-[11px] leading-snug font-medium transition-[box-shadow,transform] duration-200";

const agendaButtonDepthVariants: Variants = {
  idle: { scale: 1 },
  hover: { scale: 1.02, transition: clinical3DSpring },
  tap: { scale: 0.98, transition: { duration: 0.1 } },
};

/** Botão com realce de profundidade (sem trocar cor do texto no hover). */
export function AgendaMotionButton({
  className,
  children,
  asChild,
  ...props
}: ComponentProps<typeof Button>) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className="w-full"
      variants={agendaButtonDepthVariants}
      initial="idle"
      whileHover={reduced ? undefined : "hover"}
      whileTap={reduced ? undefined : "tap"}
    >
      <Button
        type="button"
        variant="default"
        size="sm"
        asChild={asChild}
        className={cn(agendaTopOutlineBtnClass, className)}
        {...props}
      >
        {children}
      </Button>
    </motion.div>
  );
}

/** Ícone acima do texto para caber em colunas estreitas sem vazar da caixa. */
export function AgendaCardButtonLabel({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  if (icon) {
    return (
      <span className="flex w-full min-w-0 flex-col items-center justify-center gap-0.5">
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">{icon}</span>
        <span className="w-full min-w-0 break-words text-center leading-tight">{children}</span>
      </span>
    );
  }

  return (
    <span className="block w-full min-w-0 break-words text-center leading-tight">{children}</span>
  );
}

/** Badge compacto para colunas estreitas da agenda semanal. */
export const agendaWeekBadgeClass =
  "max-w-full whitespace-normal text-center text-[9px] leading-tight px-1.5 py-0.5";
