"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FinanceAgentBox } from "@/components/dashboard/finances/FinanceAgentBox";
import { FinanceFormIntakeToolbar } from "@/components/dashboard/finances/FinanceFormIntakeToolbar";
import { PremiumFeatureTeaserCard } from "@/components/premium/PremiumFeatureTeaserCard";
import { financeOutlineBtnClass } from "./finance-outline-btn";
import type { OfficeFinanceExtractionEnvelope } from "@/lib/office-finance-ai-extract";

/**
 * Ponto único de intake no Registrar: o agente sempre decide a intenção
 * (venda, entrada, despesa, fixo, relatório/saúde financeira). Sem dropdown.
 */
export function FinanceUnifiedIntake({
  allowImageUpload,
  maxAudioMinutes,
  canUseFinanceAssistant,
  disabled,
  patients,
  services,
  financeRole = "ADMIN",
  onEnvelope,
  onAgentChanged,
  onPatientCreated,
}: {
  allowImageUpload: boolean;
  maxAudioMinutes: number;
  canUseFinanceAssistant: boolean;
  disabled?: boolean;
  patients: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string; defaultPriceCents: number; active: boolean }>;
  financeRole?: "ADMIN" | "MEMBER";
  onEnvelope: (env: OfficeFinanceExtractionEnvelope) => void;
  onAgentChanged: () => void;
  onPatientCreated: () => void;
}) {
  const isMember = financeRole === "MEMBER";

  return (
    <Card className="border-clinical/30 bg-gradient-to-b from-clinical/10 to-card shadow-sm dark:border-clinical/30 dark:from-clinical/15 dark:to-card">
      <CardHeader>
        <CardTitle>
          {isMember ? "Assistente de entradas" : "Assistente financeiro"}
        </CardTitle>
        <CardDescription>
          {isMember
            ? "Fale ou escreva a receita do cliente — a IA interpreta e preenche para revisão. Vendas e despesas ficam com o administrador."
            : "Fale, escreva ou envie comprovante de coleta ou entrega. O agente identifica venda de prótese, entrada do cliente, despesa, gasto fixo ou pergunta sobre o caixa. Toda receita exige um cliente. Nada é gravado sem a sua confirmação."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canUseFinanceAssistant ? (
          <PremiumFeatureTeaserCard featureId="finance-assistant" allowed={canUseFinanceAssistant}>
            <FinanceAgentBox
              patients={patients}
              services={services}
              allowImageUpload={allowImageUpload}
              maxAudioMinutes={maxAudioMinutes}
              financeRole={financeRole}
              onChanged={onAgentChanged}
              onPatientCreated={onPatientCreated}
            />
          </PremiumFeatureTeaserCard>
        ) : (
          <>
            <FinanceFormIntakeToolbar
              target={isMember ? "standalone" : "auto"}
              allowImageUpload={allowImageUpload}
              maxAudioMinutes={maxAudioMinutes}
              disabled={disabled}
              outlineBtnClass={financeOutlineBtnClass}
              hint={
                allowImageUpload
                  ? "Áudio, PDF, imagem ou foto. A IA decide o tipo e preenche o formulário para revisão."
                  : "Áudio disponível no seu plano. Upgrade Profissional+ para PDF, fotos e assistente conversacional."
              }
              onEnvelope={onEnvelope}
            />
            <p className="text-xs text-muted-foreground">
              O assistente conversacional (confirmação, gravação e perguntas sobre o caixa) está
              disponível no plano Profissional ou superior.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
