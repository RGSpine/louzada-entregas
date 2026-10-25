"use client";

import { PackageOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { financeOutlineBtnClass } from "./finance-outline-btn";
import { FinanceServiceEditorPanel } from "./FinanceServiceEditorPanel";
import type { OfficeFinanceExtractionEnvelope } from "@/lib/office-finance-ai-extract";

export type FinanceCatalogServiceRow = {
  id: string;
  name: string;
  description: string | null;
  defaultPriceCents: number;
  billingMode?: "SESSION" | "MONTHLY";
  active: boolean;
  serviceSpaceId: string | null;
  serviceSpaceName?: string | null;
  serviceSpaceColor?: string | null;
};

export function FinanceCatalogPanel({
  busy,
  services,
  formatBrl,
  onStartEdit,
  onToggleActive,
  onDelete,
  editorOpen,
  onEditorOpenChange,
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
  readOnly = false,
}: {
  busy: boolean;
  services: FinanceCatalogServiceRow[];
  formatBrl: (cents: number) => string;
  onStartEdit: (svc: FinanceCatalogServiceRow) => void;
  onToggleActive: (svc: FinanceCatalogServiceRow) => void;
  onDelete: (svc: FinanceCatalogServiceRow) => void;
  editorOpen: boolean;
  onEditorOpenChange: (open: boolean) => void;
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
  /** MEMBER da clínica: catálogo apenas para consulta (sem editar/desativar/excluir/adicionar). */
  readOnly?: boolean;
}) {
  const activeCount = services.filter((s) => s.active).length;
  const inactiveCount = services.length - activeCount;

  return (
    <div className="space-y-4">
      {!readOnly && editorOpen && (
        <FinanceServiceEditorPanel
          busy={busy}
          financePlan={financePlan}
          svcName={svcName}
          svcDesc={svcDesc}
          svcPriceRaw={svcPriceRaw}
          svcSpaceId={svcSpaceId}
          svcBillingMode={svcBillingMode}
          editingSvcId={editingSvcId}
          onSvcName={onSvcName}
          onSvcDesc={onSvcDesc}
          onSvcPriceRaw={onSvcPriceRaw}
          onSvcSpaceId={onSvcSpaceId}
          onSvcBillingMode={onSvcBillingMode}
          onSaveService={onSaveService}
          onCancelEditSvc={onCancelEditSvc}
          onCatalogEnvelope={onCatalogEnvelope}
          onClose={() => onEditorOpenChange(false)}
        />
      )}

      <Card className="border-border bg-white shadow-sm dark:border-border dark:bg-card">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5 text-clinical" aria-hidden />
            Catálogo de próteses
          </CardTitle>
          <CardDescription className="mt-1.5 max-w-2xl">
            Valores das próteses. Quando o áudio cita o trabalho e não diz o preço, o Financeiro usa
            este valor. A contagem de coletas e entregas continua na agenda.
          </CardDescription>
        </div>
        {!readOnly && (
          <Button
            type="button"
            size="sm"
            className="min-h-11"
            onClick={() => onEditorOpenChange(!editorOpen)}
            disabled={busy}
            aria-expanded={editorOpen}
            aria-controls="finance-service-editor"
            title="Abra o formulário para cadastrar a prótese e o valor"
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Cadastrar prótese e valor
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {services.length > 0 && (
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{services.length} no total</Badge>
            <Badge className="bg-clinical/15 text-clinical dark:bg-clinical/15 dark:text-clinical">
              {activeCount} ativo{activeCount === 1 ? "" : "s"}
            </Badge>
            {inactiveCount > 0 && (
              <Badge variant="outline" className="border-border dark:border-border">
                {inactiveCount} inativo{inactiveCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        )}

        {services.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted px-6 py-10 text-center dark:border-border dark:bg-card/50">
            <PackageOpen
              className="mx-auto mb-3 h-10 w-10 text-muted-foreground dark:text-muted-foreground"
              aria-hidden
            />
            <p className="font-medium text-foreground/90 dark:text-foreground">Nenhuma prótese no catálogo</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Cadastre o nome e o valor, por escrito, áudio ou PDF da tabela de preços.
            </p>
            {!readOnly && (
              <Button
                type="button"
                className="mt-4 min-h-11"
                onClick={() => onEditorOpenChange(true)}
                disabled={busy}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Cadastrar prótese e valor
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted text-muted-foreground dark:border-border dark:bg-card/80 dark:text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Prótese</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Descrição</th>
                  <th className="px-4 py-3 font-medium">Valor padrão</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  {!readOnly && <th className="px-4 py-3 text-right font-medium">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {services.map((svc) => (
                  <tr
                    key={svc.id}
                    className={cn(
                      "border-b border-border last:border-0 dark:border-border",
                      !svc.active && "bg-muted/80 dark:bg-card/40",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{svc.name}</span>
                        {svc.serviceSpaceId ? (
                          <Badge
                            variant="secondary"
                            className="gap-1.5 font-normal"
                            style={{ borderColor: svc.serviceSpaceColor ?? undefined }}
                          >
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ backgroundColor: svc.serviceSpaceColor ?? "#888" }}
                              aria-hidden
                            />
                            {svc.serviceSpaceName ?? "Espaço"}
                          </Badge>
                        ) : null}
                        {svc.billingMode === "MONTHLY" ? (
                          <Badge variant="outline" className="font-normal">
                            Mensalidade
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="hidden max-w-xs truncate px-4 py-3 text-muted-foreground md:table-cell">
                      {svc.description?.trim() || "—"}
                    </td>
                    <td className="px-4 py-3 font-medium text-clinical dark:text-clinical">
                      {formatBrl(svc.defaultPriceCents)}
                    </td>
                    <td className="px-4 py-3">
                      {svc.active ? (
                        <Badge className="bg-clinical/15 text-clinical dark:bg-clinical/15 dark:text-clinical">
                          Ativo
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Inativo</Badge>
                      )}
                    </td>
                    {!readOnly && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={financeOutlineBtnClass}
                            disabled={busy}
                            onClick={() => onStartEdit(svc)}
                          >
                            Editar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={financeOutlineBtnClass}
                            disabled={busy}
                            onClick={() => onToggleActive(svc)}
                          >
                            {svc.active ? "Desativar" : "Reativar"}
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive "
                            disabled={busy}
                            onClick={() => onDelete(svc)}
                            aria-label={`Excluir ${svc.name}`}
                            title="Excluir"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {services.some((s) => s.description?.trim()) && (
          <p className="text-xs text-muted-foreground md:hidden">
            Descrições completas aparecem em ecrãs maiores ou ao editar a prótese.
          </p>
        )}
      </CardContent>
      </Card>
    </div>
  );
}
