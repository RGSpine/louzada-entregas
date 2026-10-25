"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FinancialTransactionMethod } from "@prisma/client";
import type { OfficeFinanceExtractionEnvelope } from "@/lib/office-finance-ai-extract";
import { FinanceUnifiedIntake } from "./FinanceUnifiedIntake";
import { financeOutlineBtnClass } from "./finance-outline-btn";
import { ServiceSpaceSelect } from "./ServiceSpaceSelect";
import { CardInstallmentOptions } from "./CardInstallmentOptions";
import type { CardInterestMode } from "@/lib/finance/card-installments";
import { rawMoneyToCents } from "./finance-format";

const METHOD_PT: Record<FinancialTransactionMethod, string> = {
  CASH: "Dinheiro",
  PIX: "PIX",
  CARD: "Cartão",
  TRANSFER: "Transferência",
  OTHER: "Outro",
};

type PatientPurchasesPayload = Array<{
  purchase: {
    id: string;
    serviceName: string;
    type: string;
    agreedPriceCents: number;
  };
  pendingCount: number;
  consumedCount: number;
  sessions: Array<{
    id: string;
    sequence: number;
    status: string;
    consumedAt: Date | null;
  }>;
}>;

export function FinanceRegisterPanel({
  busy,
  financePlan,
  financeRole = "ADMIN",
  patients,
  services,
  activeServices,
  onEnvelope,
  onAgentChanged,
  onPatientCreated,
  purchasePatientId,
  purchaseServiceId,
  purchaseSpaceId,
  purchasePriceRaw,
  purchaseNotes,
  registerPayment,
  paymentMethod,
  purchaseInstallmentCount,
  purchaseInterestMode,
  purchaseInterestPercentRaw,
  txDateStr,
  onPurchasePatientId,
  onPurchaseServiceId,
  onPurchaseSpaceId,
  onPurchasePriceRaw,
  onPurchaseNotes,
  onRegisterPayment,
  onPaymentMethod,
  onPurchaseInstallmentCount,
  onPurchaseInterestMode,
  onPurchaseInterestPercentRaw,
  onTxDateStr,
  onPurchaseSubmit,
  txAmountRaw,
  txMethod,
  txDescription,
  txPatientId,
  txSpaceId,
  onTxAmountRaw,
  onTxMethod,
  onTxDescription,
  onTxPatientId,
  onTxSpaceId,
  onTxSubmit,
}: {
  busy: boolean;
  financePlan: {
    maxAudioMinutes: number;
    officeFinanceAllowsImageUpload: boolean;
    canUseFinanceAssistant: boolean;
  } | null;
  /** MEMBER: só entradas (sem venda/despesa na UI). */
  financeRole?: "ADMIN" | "MEMBER";
  /** MEMBER com flag; ADMIN sempre true. */
  canManagePatientServices?: boolean;
  patients: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string; defaultPriceCents: number; active: boolean }>;
  activeServices: Array<{ id: string; name: string; defaultPriceCents: number }>;
  onEnvelope: (env: OfficeFinanceExtractionEnvelope) => void;
  onAgentChanged: () => void;
  onPatientCreated: () => void;
  purchasePatientId: string;
  purchaseServiceId: string;
  purchaseSpaceId: string;
  purchaseType: "SINGLE" | "PACKAGE";
  purchasePackageSessions: string;
  purchasePriceRaw: string;
  purchaseNotes: string;
  purchasePerformedDates: string[];
  registerPayment: boolean;
  paymentMethod: FinancialTransactionMethod;
  purchaseInstallmentCount: string;
  purchaseInterestMode: CardInterestMode;
  purchaseInterestPercentRaw: string;
  txDateStr: string;
  onPurchasePatientId: (v: string) => void;
  onPurchaseServiceId: (v: string) => void;
  onPurchaseSpaceId: (v: string) => void;
  onPurchaseType: (v: "SINGLE" | "PACKAGE") => void;
  onPurchasePackageSessions: (v: string) => void;
  onPurchasePriceRaw: (v: string) => void;
  onPurchaseNotes: (v: string) => void;
  onPurchasePerformedDates: (v: string[]) => void;
  onRegisterPayment: (v: boolean) => void;
  onPaymentMethod: (v: FinancialTransactionMethod) => void;
  onPurchaseInstallmentCount: (v: string) => void;
  onPurchaseInterestMode: (v: CardInterestMode) => void;
  onPurchaseInterestPercentRaw: (v: string) => void;
  onTxDateStr: (v: string) => void;
  onPurchaseSubmit: (e: React.FormEvent) => void;
  txAmountRaw: string;
  txMethod: FinancialTransactionMethod;
  txDescription: string;
  txPatientId: string;
  txSpaceId: string;
  onTxAmountRaw: (v: string) => void;
  onTxMethod: (v: FinancialTransactionMethod) => void;
  onTxDescription: (v: string) => void;
  onTxPatientId: (v: string) => void;
  onTxSpaceId: (v: string) => void;
  onTxSubmit: (e: React.FormEvent) => void;
  purchaseHistory: PatientPurchasesPayload | null;
  sessionMarkDraft: {
    patientId: string;
    purchaseId: string;
    dates: string[];
    summary: string | null;
    needsPurchasePick: boolean;
  } | null;
  onSessionMarkDraftChange: (
    next: {
      patientId: string;
      purchaseId: string;
      dates: string[];
      summary: string | null;
      needsPurchasePick: boolean;
    } | null,
  ) => void;
  onConfirmSessionMarkDraft: () => void;
  onConsumeSession: (sessionId: string) => void;
  formatBrl: (cents: number) => string;
}) {
  const isMember = financeRole === "MEMBER";

  return (
    <div className="space-y-6">
      {financePlan && (
        <FinanceUnifiedIntake
          allowImageUpload={financePlan.officeFinanceAllowsImageUpload}
          maxAudioMinutes={financePlan.maxAudioMinutes}
          canUseFinanceAssistant={financePlan.canUseFinanceAssistant}
          disabled={busy}
          patients={patients}
          services={services}
          financeRole={financeRole}
          onEnvelope={onEnvelope}
          onAgentChanged={onAgentChanged}
          onPatientCreated={onPatientCreated}
        />
      )}

      <div className={`grid gap-6 ${isMember ? "" : ""}`}>
        {!isMember && (
        <Card className="border-border bg-white shadow-sm dark:border-border dark:bg-card">
          <CardHeader>
            <CardTitle>Venda do trabalho</CardTitle>
            <CardDescription>
              Cada receita fica ligada a um cliente do laboratório (dentista ou clínica) e a um
              serviço de prótese — na coleta ou na entrega. Selecione no menu ou diga o nome no áudio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onPurchaseSubmit} className="space-y-3">
              <ServiceSpaceSelect
                id="pp-space"
                value={purchaseSpaceId}
                onChange={onPurchaseSpaceId}
                label="Espaço desta venda"
                disabled={busy}
              />
              <div>
                <Label htmlFor="pp-patient">Cliente</Label>
                <select
                  id="pp-patient"
                  className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm shadow-sm dark:border-border dark:bg-card"
                  value={purchasePatientId}
                  onChange={(e) => onPurchasePatientId(e.target.value)}
                  required
                >
                  <option value="">Selecione o cliente</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="pp-svc">Prótese</Label>
                <select
                  id="pp-svc"
                  className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm shadow-sm dark:border-border dark:bg-card"
                  value={purchaseServiceId}
                  onChange={(e) => onPurchaseServiceId(e.target.value)}
                >
                  {activeServices.length === 0 ? (
                    <option value="">Cadastre uma prótese ativa no Catálogo</option>
                  ) : (
                    activeServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <Label htmlFor="pp-price">Valor combinado (R$)</Label>
                <Input
                  id="pp-price"
                  inputMode="decimal"
                  value={purchasePriceRaw}
                  onChange={(e) => onPurchasePriceRaw(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="pp-notes">Notas internas</Label>
                <Textarea
                  id="pp-notes"
                  value={purchaseNotes}
                  onChange={(e) => onPurchaseNotes(e.target.value)}
                  rows={2}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={registerPayment}
                  onChange={(e) => onRegisterPayment(e.target.checked)}
                />
                Registrar receita no caixa nesta data
              </label>
              {registerPayment && (
                <>
                  <div>
                    <Label htmlFor="pay-m">Forma de pagamento</Label>
                    <select
                      id="pay-m"
                      className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                      value={paymentMethod}
                      onChange={(e) => {
                        const next = e.target.value as FinancialTransactionMethod;
                        onPaymentMethod(next);
                        if (next !== "CARD") {
                          onPurchaseInstallmentCount("");
                          onPurchaseInterestMode("none");
                          onPurchaseInterestPercentRaw("");
                        }
                      }}
                    >
                      {(Object.entries(METHOD_PT) as Array<[FinancialTransactionMethod, string]>).map(
                        ([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                  {paymentMethod === "CARD" ? (
                    <CardInstallmentOptions
                      idPrefix="register-purchase"
                      installmentCount={purchaseInstallmentCount}
                      onInstallmentCountChange={onPurchaseInstallmentCount}
                      interestMode={purchaseInterestMode}
                      onInterestModeChange={onPurchaseInterestMode}
                      interestPercentRaw={purchaseInterestPercentRaw}
                      onInterestPercentRawChange={onPurchaseInterestPercentRaw}
                      baseAmountCents={rawMoneyToCents(purchasePriceRaw)}
                    />
                  ) : null}
                  <div>
                    <Label htmlFor="pay-d">Data do recebimento</Label>
                    <Input
                      id="pay-d"
                      type="date"
                      value={txDateStr}
                      onChange={(e) => onTxDateStr(e.target.value)}
                    />
                  </div>
                </>
              )}
              <Button type="submit" className="w-full" disabled={busy || activeServices.length === 0}>
                Registrar venda
              </Button>
            </form>
          </CardContent>
        </Card>
        )}

        {isMember ? (
        <Card className="border-border bg-white shadow-sm dark:border-border dark:bg-card">
          <CardHeader>
            <CardTitle>Registrar entrada</CardTitle>
            <CardDescription>
              Receitas vinculadas a um cliente do laboratório (selecione no menu).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onTxSubmit} className="space-y-3">
              <ServiceSpaceSelect
                id="tx-space"
                value={txSpaceId}
                onChange={onTxSpaceId}
                label="Espaço deste lançamento"
                disabled={busy}
              />
              <div>
                <Label htmlFor="tv-patient">Cliente</Label>
                <select
                  id="tv-patient"
                  className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                  value={txPatientId}
                  onChange={(e) => onTxPatientId(e.target.value)}
                  required
                >
                  <option value="">Selecione o cliente</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="tv-val">Valor (R$)</Label>
                <Input
                  id="tv-val"
                  inputMode="decimal"
                  value={txAmountRaw}
                  onChange={(e) => onTxAmountRaw(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="tv-d">Data</Label>
                <Input
                  id="tv-d"
                  type="date"
                  value={txDateStr}
                  onChange={(e) => onTxDateStr(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="tv-m">Forma</Label>
                <select
                  id="tv-m"
                  className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                  value={txMethod}
                  onChange={(e) => onTxMethod(e.target.value as FinancialTransactionMethod)}
                >
                  {(Object.entries(METHOD_PT) as Array<[FinancialTransactionMethod, string]>).map(
                    ([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div>
                <Label htmlFor="tv-desc">Descrição</Label>
                <Textarea
                  id="tv-desc"
                  value={txDescription}
                  onChange={(e) => onTxDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <Button type="submit" variant="outline" className={financeOutlineBtnClass} disabled={busy}>
                Registrar entrada
              </Button>
            </form>
          </CardContent>
        </Card>
        ) : null}
      </div>

    </div>
  );
}
