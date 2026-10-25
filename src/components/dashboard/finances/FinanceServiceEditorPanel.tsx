"use client";

import { ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FinanceFormIntakeToolbar } from "@/components/dashboard/finances/FinanceFormIntakeToolbar";
import { ServiceSpaceSelect } from "./ServiceSpaceSelect";
import { financeOutlineBtnClass } from "./finance-outline-btn";
import type { OfficeFinanceExtractionEnvelope } from "@/lib/office-finance-ai-extract";

export function FinanceServiceEditorPanel({
  busy,
  financePlan,
  svcName,
  svcDesc,
  svcPriceRaw,
  svcSpaceId,
  svcBillingMode,
  editingSvcId,
  onSvcName,
  onSvcDesc,
  onSvcPriceRaw,
  onSvcSpaceId,
  onSvcBillingMode,
  onSaveService,
  onCancelEditSvc,
  onCatalogEnvelope,
  onClose,
}: {
  busy: boolean;
  financePlan: {
    maxAudioMinutes: number;
    officeFinanceAllowsImageUpload: boolean;
  } | null;
  svcName: string;
  svcDesc: string;
  svcPriceRaw: string;
  svcSpaceId: string;
  svcBillingMode: "SESSION" | "MONTHLY";
  editingSvcId: string | null;
  onSvcName: (value: string) => void;
  onSvcDesc: (value: string) => void;
  onSvcPriceRaw: (value: string) => void;
  onSvcSpaceId: (value: string) => void;
  onSvcBillingMode: (value: "SESSION" | "MONTHLY") => void;
  onSaveService: (event: React.FormEvent) => void;
  onCancelEditSvc: () => void;
  onCatalogEnvelope: (envelope: OfficeFinanceExtractionEnvelope) => void;
  onClose: () => void;
}) {
  return (
    <Card id="finance-service-editor" className="border-clinical/30 bg-clinical/5 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Próteses e valores</CardTitle>
          <CardDescription className="mt-1.5">
            Cadastre o nome da prótese e o valor. O áudio da coleta ou da entrega usa esse preço
            quando não cita outro.
          </CardDescription>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="min-h-11 min-w-11 shrink-0"
          onClick={onClose}
          aria-label="Fechar cadastro de próteses e valores"
          title="Fechar cadastro"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {financePlan && (
          <FinanceFormIntakeToolbar
            target="catalog"
            allowImageUpload={financePlan.officeFinanceAllowsImageUpload}
            maxAudioMinutes={financePlan.maxAudioMinutes}
            disabled={busy}
            outlineBtnClass={financeOutlineBtnClass}
            hint="Envie o PDF da tabela ou descreva a prótese e o valor em áudio. O que for reconhecido entra no catálogo."
            onEnvelope={onCatalogEnvelope}
          />
        )}

        <form onSubmit={onSaveService} className="space-y-3">
          <ServiceSpaceSelect
            id="svc-space"
            value={svcSpaceId}
            onChange={onSvcSpaceId}
            label="Espaço desta prótese"
            disabled={busy}
          />
          <div>
            <Label htmlFor="svc-name">Nome da prótese</Label>
            <Input id="svc-name" value={svcName} onChange={(event) => onSvcName(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="svc-price">
              {svcBillingMode === "MONTHLY" ? "Valor mensal (R$)" : "Valor padrão (R$)"}
            </Label>
            <Input
              id="svc-price"
              inputMode="decimal"
              placeholder="250,00"
              value={svcPriceRaw}
              onChange={(event) => onSvcPriceRaw(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="svc-billing">Forma de cobrança</Label>
            <select
              id="svc-billing"
              className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:bg-card"
              value={svcBillingMode}
              onChange={(event) =>
                onSvcBillingMode(event.target.value === "MONTHLY" ? "MONTHLY" : "SESSION")
              }
              disabled={busy}
            >
              <option value="SESSION">Por trabalho (coleta ou entrega)</option>
              <option value="MONTHLY">Mensalidade do cliente</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Mensalidade vale para um cliente fixo do laboratório. O restante é um trabalho de prótese.
            </p>
          </div>
          <div>
            <Label htmlFor="svc-desc">Descrição (opcional)</Label>
            <Textarea
              id="svc-desc"
              value={svcDesc}
              onChange={(event) => onSvcDesc(event.target.value)}
              rows={3}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {editingSvcId ? "Salvar alterações" : "Adicionar ao catálogo"}
            </Button>
            {editingSvcId && (
              <Button
                type="button"
                variant="ghost"
                className="text-foreground/90"
                onClick={onCancelEditSvc}
              >
                Cancelar edição
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              <ChevronUp className="mr-2 h-4 w-4" aria-hidden />
              Recolher
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
