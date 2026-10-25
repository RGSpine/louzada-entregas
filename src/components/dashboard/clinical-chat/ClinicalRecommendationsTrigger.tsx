"use client";

import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ClinicalRecommendationsTriggerProps = {
  onClick: () => void;
  className?: string;
  variant?: "header" | "floating";
  disabled?: boolean;
};

const triggerStyles = cn(
  "border-border bg-card text-foreground shadow-[var(--shadow-elevation-1)]",
  "transition-[transform,box-shadow,background-color,color] duration-200 ease-out",
  "hover:scale-[1.04] hover:border-border hover:bg-card hover:text-foreground hover:shadow-[var(--shadow-elevation-2)]",
  "active:scale-[0.97] active:shadow-[var(--shadow-elevation-1)]",
  "dark:bg-card dark:text-foreground dark:hover:bg-muted/40 dark:hover:text-foreground",
  "[&_svg]:text-primary dark:[&_svg]:text-primary",
);

export function ClinicalRecommendationsTrigger({
  onClick,
  className,
  variant = "header",
  disabled = false,
}: ClinicalRecommendationsTriggerProps) {
  if (variant === "floating") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "hidden gap-1.5 rounded-full backdrop-blur-sm md:inline-flex",
          triggerStyles,
          className,
        )}
        onClick={onClick}
        disabled={disabled}
        title="Indicações para você — artigos baseados no seu perfil e conversas recentes"
        aria-label="Abrir indicações de artigos"
      >
        <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
        <span className="text-sm font-medium">Indicações</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn("h-9 w-9 shrink-0 rounded-lg", triggerStyles, className)}
      onClick={onClick}
      disabled={disabled}
      title="Indicações"
      aria-label="Abrir indicações de artigos"
    >
      <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
    </Button>
  );
}
