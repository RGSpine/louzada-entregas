"use client";

import { Check, X } from "lucide-react";
import { ClinicalCalmModal } from "@/components/ui/ClinicalCalmModal";
import { Button } from "@/components/ui/button";
import {
  planFeatureItemClass,
  planFeatureListClass,
} from "@/components/planos/plan-pricing-styles";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  features: string[];
  featured?: boolean;
};

export function PlanFeaturesSheet({
  open,
  onClose,
  title,
  description,
  features,
  featured = false,
}: Props) {
  const headingId = "plan-features-sheet-title";

  return (
    <ClinicalCalmModal
      open={open}
      onClose={onClose}
      align="bottom"
      ariaLabel={`Recursos do plano ${title}`}
      labelledBy={headingId}
      className="max-h-[min(88dvh,720px)] overflow-hidden rounded-t-2xl rounded-b-none p-0 sm:rounded-xl sm:p-0"
    >
      <div className="flex max-h-[min(88dvh,720px)] flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={headingId} className="text-lg font-bold text-foreground">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>

        <ul
          className={cn(
            planFeatureListClass,
            "mb-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4",
          )}
        >
          {features.map((feature) => (
            <li key={feature} className={planFeatureItemClass}>
              <Check
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  featured ? "text-primary" : "text-success",
                )}
                aria-hidden
              />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        <div className="shrink-0 border-t border-border px-5 py-4 safe-area-pb">
          <Button type="button" variant="outline" className="w-full" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </ClinicalCalmModal>
  );
}
