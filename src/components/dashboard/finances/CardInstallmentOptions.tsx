"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type CardInterestMode,
  computeCardInstallmentBreakdown,
  formatCardInstallmentPreview,
  parseInterestPercent,
} from "@/lib/finance/card-installments";

/**
 * Parcelas no crédito + opção sem/com juros e preview do total/parcelas.
 * Cálculo só em código (nunca na IA).
 */
export function CardInstallmentOptions({
  installmentCount,
  onInstallmentCountChange,
  interestMode,
  onInterestModeChange,
  interestPercentRaw,
  onInterestPercentRawChange,
  baseAmountCents,
  idPrefix = "card-inst",
}: {
  installmentCount: string;
  onInstallmentCountChange: (value: string) => void;
  interestMode: CardInterestMode;
  onInterestModeChange: (mode: CardInterestMode) => void;
  interestPercentRaw: string;
  onInterestPercentRawChange: (value: string) => void;
  /** Valor do catálogo/base em centavos; null se ainda inválido. */
  baseAmountCents: number | null;
  idPrefix?: string;
}) {
  const n = Number(installmentCount);
  const showInterest = Number.isInteger(n) && n >= 2 && n <= 48;

  let preview: string | null = null;
  if (showInterest && baseAmountCents != null && baseAmountCents > 0) {
    const pct =
      interestMode === "with" ? parseInterestPercent(interestPercentRaw) : 0;
    if (interestMode === "none" || (pct != null && pct > 0)) {
      try {
        const plan = computeCardInstallmentBreakdown({
          baseAmountCents,
          installmentCount: n,
          withInterest: interestMode === "with",
          interestPercent: pct ?? 0,
        });
        preview = formatCardInstallmentPreview(plan);
      } catch {
        preview = null;
      }
    } else if (interestMode === "with") {
      preview = "Informe a % de juros para ver o valor das parcelas.";
    }
  }

  return (
    <div className="space-y-3 sm:col-span-2">
      <div>
        <Label htmlFor={`${idPrefix}-installments`}>Parcelas no crédito</Label>
        <Input
          id={`${idPrefix}-installments`}
          type="number"
          min={2}
          max={48}
          placeholder="ex.: 3"
          value={installmentCount}
          onChange={(e) => onInstallmentCountChange(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Opcional. Deixe vazio para cartão à vista.
        </p>
      </div>

      {showInterest ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Juros no parcelamento</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${idPrefix}-interest-mode`}
                checked={interestMode === "none"}
                onChange={() => onInterestModeChange("none")}
              />
              Sem juros
              <span className="text-muted-foreground">(valor do catálogo)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${idPrefix}-interest-mode`}
                checked={interestMode === "with"}
                onChange={() => onInterestModeChange("with")}
              />
              Com juros
            </label>
          </div>

          {interestMode === "with" ? (
            <div className="max-w-xs">
              <Label htmlFor={`${idPrefix}-interest-pct`}>Porcentagem de juros (%)</Label>
              <Input
                id={`${idPrefix}-interest-pct`}
                inputMode="decimal"
                placeholder="ex.: 5 ou 2,99"
                value={interestPercentRaw}
                onChange={(e) => onInterestPercentRawChange(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Juros flat sobre o valor do catálogo; as parcelas são recalculadas
                automaticamente.
              </p>
            </div>
          ) : null}

          {preview ? (
            <p className="rounded-md border border-clinical/30 bg-clinical/5 px-3 py-2 text-xs text-foreground">
              {preview}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}
