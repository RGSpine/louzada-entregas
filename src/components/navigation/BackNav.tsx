import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Ícone circular `<` — mesma linguagem do scroll horizontal da landing, em escala de cabeçalho. */
export const backNavChevronClass =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background/90 text-primary shadow-[var(--shadow-elevation-1)] backdrop-blur-sm dark:border-white/15 dark:bg-card/90 dark:text-white";

const backNavControlClass =
  "inline-flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";

type SharedProps = {
  label?: string;
  className?: string;
  ariaLabel?: string;
};

function BackNavChevron() {
  return (
    <span className={backNavChevronClass} aria-hidden>
      <ChevronLeft className="h-4 w-4" />
    </span>
  );
}

export function BackNavLink({
  href,
  label = "Voltar",
  className,
  ariaLabel,
}: SharedProps & { href: string }) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel ?? label}
      className={cn(backNavControlClass, className)}
    >
      <BackNavChevron />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function BackNavButton({
  onClick,
  label = "Voltar",
  className,
  ariaLabel,
}: SharedProps & { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className={cn(backNavControlClass, className)}
    >
      <BackNavChevron />
      <span className="truncate">{label}</span>
    </button>
  );
}
