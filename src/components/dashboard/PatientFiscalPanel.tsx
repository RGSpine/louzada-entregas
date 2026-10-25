"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getPatientFiscalSummary,
  updatePatientFiscalData,
} from "@/app/actions/fiscal-profile";
import { formatCpfInput } from "@/lib/fiscal/validation";

interface PatientFiscalPanelProps {
  patientId: string;
}

export function PatientFiscalPanel({ patientId }: PatientFiscalPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cpf, setCpf] = useState("");
  const [payerCpf, setPayerCpf] = useState("");
  const [consent, setConsent] = useState(false);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [maskedHint, setMaskedHint] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPatientFiscalSummary(patientId);
      if (!res.success || !res.data) {
        if (!res.success) toast.error(res.error);
        return;
      }
      setMaskedHint(
        res.data.hasConsent
          ? `Beneficiário: ${res.data.cpfMasked}${res.data.payerCpfMasked !== "—" ? ` · Pagador: ${res.data.payerCpfMasked}` : ""}`
          : null,
      );
      setConsent(res.data.hasConsent);
      setSummaryLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (open && !summaryLoaded) {
      void loadSummary();
    }
  }, [open, summaryLoaded, loadSummary]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await updatePatientFiscalData({
        patientId,
        cpf,
        payerCpf,
        fiscalConsent: consent,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Dados fiscais guardados.");
      setCpf("");
      setPayerCpf("");
      setSummaryLoaded(false);
      await loadSummary();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-border bg-white shadow-sm dark:border-border dark:bg-card">
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Dados fiscais (opcional)</CardTitle>
            <CardDescription>
              CPF para exportação Receita Saúde ou NFS-e futura. Só usado com o seu consentimento.
            </CardDescription>
          </div>
          {open ? (
            <ChevronUp className="h-5 w-5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
          )}
        </div>
        {maskedHint && !open && (
          <p className="text-xs text-muted-foreground mt-1">{maskedHint}</p>
        )}
      </CardHeader>
      {open && (
        <CardContent>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> A carregar…
            </p>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              {maskedHint && (
                <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground dark:bg-muted dark:text-muted-foreground">
                  Registo atual: {maskedHint}. Preencha abaixo para alterar.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="pat-cpf">CPF do beneficiário (utente)</Label>
                <Input
                  id="pat-cpf"
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={(e) => setCpf(formatCpfInput(e.target.value))}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pat-payer-cpf">CPF do pagador (se diferente)</Label>
                <Input
                  id="pat-payer-cpf"
                  inputMode="numeric"
                  placeholder="Opcional — ex.: responsável legal"
                  value={payerCpf}
                  onChange={(e) => setPayerCpf(formatCpfInput(e.target.value))}
                  autoComplete="off"
                />
              </div>
              <label className="flex items-start gap-2 text-sm text-foreground/90">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  Autorizo o uso destes dados para exportação fiscal (Receita Saúde / NFS-e), conforme a{" "}
                  <Link href="/privacidade" className="text-primary underline dark:text-primary">
                    política de privacidade
                  </Link>
                  .
                </span>
              </label>
              <Button type="submit" disabled={saving} className="gap-2">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Guardar dados fiscais
              </Button>
            </form>
          )}
        </CardContent>
      )}
    </Card>
  );
}
