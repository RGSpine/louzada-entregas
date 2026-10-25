"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListTree, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface PatientClinicalCaseHighlightsProps {
  bullets: string[] | null;
  className?: string;
  /** Abre a revisão manual do resumo e dos tópicos. */
  onEdit?: () => void;
}

export function PatientClinicalCaseHighlights({
  bullets,
  className,
  onEdit,
}: PatientClinicalCaseHighlightsProps) {
  const hasBullets = bullets && bullets.length > 0;

  return (
    <Card
      className={cn(
        "bg-card border-border border-l-4 border-l-clinical mb-8 scroll-mt-24",
        className
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2 text-foreground">
            <ListTree className="h-5 w-5 text-clinical" />
            Tópicos principais do caso
          </CardTitle>
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-clinical transition-colors hover:bg-clinical/10"
              title="Corrigir resumo e tópicos"
            >
              <Pencil className="h-4 w-4" />
              Corrigir
            </button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Panorama clínico sucinto ao longo das evoluções — gerado junto ao
          resumo clínico (botão Atualizar ou após novas evoluções).
        </p>
      </CardHeader>
      <CardContent>
        {hasBullets ? (
          <ul className="space-y-2 text-sm text-foreground dark:text-foreground">
            {bullets!.map((line, i) => (
              <li
                key={`${i}-${line.slice(0, 24)}`}
                className="flex gap-2 rounded-lg bg-muted dark:bg-muted/80 px-3 py-2 border border-border/80 dark:border-border"
              >
                <span
                  className="mt-0.5 shrink-0 font-medium text-clinical dark:text-clinical"
                  aria-hidden
                >
                  {i + 1}.
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ainda não há tópicos listados. Atualize o resumo clínico (botão no
            card abaixo) ou registre evoluções para que a IA extraia os fatores
            principais deste caso.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
