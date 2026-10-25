"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FiscalIssuerPanel } from "@/components/dashboard/FiscalIssuerPanel";
import { getMyFiscalProfile, updateMyFiscalProfile } from "@/app/actions/fiscal-profile";
import {
  CARNE_LEAO_OCCUPATION_OPTIONS,
  resolveCarneLeaoOccupationCode,
} from "@/lib/fiscal/carne-leao-occupation";
import { resolveDefaultNfseServiceCode } from "@/lib/fiscal/nfse-service-codes";
import { formatCnpjInput, formatCpfInput } from "@/lib/fiscal/validation";
import type { FiscalRegime } from "@prisma/client";

interface ProfileFiscalSectionProps {
  profession: string | null;
}

export function ProfileFiscalSection({ profession }: ProfileFiscalSectionProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issuerReloadKey, setIssuerReloadKey] = useState(0);
  const [regime, setRegime] = useState<FiscalRegime>("UNSPECIFIED");
  const [cpf, setCpf] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [occupationCode, setOccupationCode] = useState("");
  const [nfseServiceCode, setNfseServiceCode] = useState("");
  const [nfseIssAliquotaPercent, setNfseIssAliquotaPercent] = useState("2");
  const [cpfMasked, setCpfMasked] = useState("—");
  const [issuerRazaoSocial, setIssuerRazaoSocial] = useState("");
  const [issuerInscricaoMunicipal, setIssuerInscricaoMunicipal] = useState("");
  const [issuerCodigoMunicipio, setIssuerCodigoMunicipio] = useState("");
  const [issuerAddressLogradouro, setIssuerAddressLogradouro] = useState("");
  const [issuerAddressNumero, setIssuerAddressNumero] = useState("");
  const [issuerAddressBairro, setIssuerAddressBairro] = useState("");
  const [issuerAddressCidade, setIssuerAddressCidade] = useState("");
  const [issuerAddressUf, setIssuerAddressUf] = useState("");
  const [issuerAddressCep, setIssuerAddressCep] = useState("");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await getMyFiscalProfile();
        if (!res.success || !res.data) return;
        const d = res.data;
        setRegime(d.fiscalRegime);
        setCpfMasked(d.professionalCpfMasked);
        setOccupationCode(
          d.carneLeaoOccupationCode ??
            resolveCarneLeaoOccupationCode(profession, null) ??
            "",
        );
        setNfseServiceCode(
          d.nfseServiceCode ?? resolveDefaultNfseServiceCode(profession, null) ?? "",
        );
        setNfseIssAliquotaPercent(
          d.nfseIssAliquotaPercent != null ? String(d.nfseIssAliquotaPercent) : "2",
        );
        setIssuerRazaoSocial(d.issuerRazaoSocial ?? "");
        setIssuerInscricaoMunicipal(d.issuerInscricaoMunicipal ?? "");
        setIssuerCodigoMunicipio(d.issuerCodigoMunicipio ?? "");
        setIssuerAddressLogradouro(d.issuerAddressLogradouro ?? "");
        setIssuerAddressNumero(d.issuerAddressNumero ?? "");
        setIssuerAddressBairro(d.issuerAddressBairro ?? "");
        setIssuerAddressCidade(d.issuerAddressCidade ?? "");
        setIssuerAddressUf(d.issuerAddressUf ?? "");
        setIssuerAddressCep(d.issuerAddressCep ?? "");
      } finally {
        setLoading(false);
      }
    })();
  }, [profession]);

  useEffect(() => {
    if (regime === "PF_CARNE_LEAO" && !occupationCode) {
      const auto = resolveCarneLeaoOccupationCode(profession, null);
      if (auto) setOccupationCode(auto);
    }
    if ((regime === "PJ_SIMPLES" || regime === "PJ_PRESUMIDO") && !nfseServiceCode) {
      const auto = resolveDefaultNfseServiceCode(profession, null);
      if (auto) setNfseServiceCode(auto);
    }
  }, [regime, profession, occupationCode, nfseServiceCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await updateMyFiscalProfile({
        fiscalRegime: regime,
        professionalCpf: cpf,
        professionalCnpj: cnpj,
        carneLeaoOccupationCode: occupationCode,
        nfseServiceCode,
        nfseIssAliquotaPercent: Number.parseFloat(nfseIssAliquotaPercent),
        issuerRazaoSocial,
        issuerInscricaoMunicipal,
        issuerCodigoMunicipio,
        issuerAddressLogradouro,
        issuerAddressNumero,
        issuerAddressBairro,
        issuerAddressCidade,
        issuerAddressUf,
        issuerAddressCep,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Dados fiscais guardados.");
      setCpf("");
      setCnpj("");
      setIssuerReloadKey((k) => k + 1);
      const refreshed = await getMyFiscalProfile();
      if (refreshed.success && refreshed.data) {
        setCpfMasked(refreshed.data.professionalCpfMasked);
      }
    } finally {
      setSaving(false);
    }
  }

  const isPj = regime === "PJ_SIMPLES" || regime === "PJ_PRESUMIDO";

  return (
    <Card className="mb-8 border-border bg-white dark:border-border dark:bg-card">
      <CardHeader>
        <CardTitle className="text-foreground">Dados fiscais</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> A carregar…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              O Louzada Entregas prepara exportação para Receita Saúde (PF) ou emissão de NFS-e (PJ).{" "}
              <strong>Não substitui contador</strong> — valide códigos de serviço e alíquota ISS com
              seu contador.
            </p>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground/90">
                Regime tributário
              </legend>
              {(
                [
                  ["PF_CARNE_LEAO", "Pessoa física (Receita Saúde / Carnê-Leão)"],
                  ["PJ_SIMPLES", "Pessoa jurídica — Simples Nacional"],
                  ["PJ_PRESUMIDO", "Pessoa jurídica — Presumido/Real"],
                  ["UNSPECIFIED", "Ainda não sei / configurar depois"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="fiscalRegime"
                    value={value}
                    checked={regime === value}
                    onChange={() => setRegime(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>

            {regime === "PF_CARNE_LEAO" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="fiscal-cpf">CPF profissional</Label>
                  <Input
                    id="fiscal-cpf"
                    inputMode="numeric"
                    placeholder={cpfMasked !== "—" ? `Atual: ${cpfMasked}` : "000.000.000-00"}
                    value={cpf}
                    onChange={(e) => setCpf(formatCpfInput(e.target.value))}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">Mesmo CPF usado no Carnê-Leão Web.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fiscal-occ">Código ocupação Carnê-Leão</Label>
                  <select
                    id="fiscal-occ"
                    className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-background"
                    value={occupationCode}
                    onChange={(e) => setOccupationCode(e.target.value)}
                  >
                    <option value="">Selecione…</option>
                    {CARNE_LEAO_OCCUPATION_OPTIONS.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.code} — {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {isPj && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="fiscal-cnpj">CNPJ do consultório</Label>
                  <Input
                    id="fiscal-cnpj"
                    inputMode="numeric"
                    placeholder="00.000.000/0000-00"
                    value={cnpj}
                    onChange={(e) => setCnpj(formatCnpjInput(e.target.value))}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="fiscal-nfse-code">Código de serviço NFS-e (LC 116)</Label>
                    <Input
                      id="fiscal-nfse-code"
                      placeholder="04.01"
                      value={nfseServiceCode}
                      onChange={(e) => setNfseServiceCode(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fiscal-iss">Alíquota ISS (%)</Label>
                    <Input
                      id="fiscal-iss"
                      type="number"
                      min={0}
                      max={20}
                      step={0.01}
                      value={nfseIssAliquotaPercent}
                      onChange={(e) => setNfseIssAliquotaPercent(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="issuer-razao">Razão social do consultório</Label>
                  <Input
                    id="issuer-razao"
                    value={issuerRazaoSocial}
                    onChange={(e) => setIssuerRazaoSocial(e.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="issuer-im">Inscrição municipal</Label>
                    <Input
                      id="issuer-im"
                      value={issuerInscricaoMunicipal}
                      onChange={(e) => setIssuerInscricaoMunicipal(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="issuer-ibge">Código município IBGE (7 dígitos)</Label>
                    <Input
                      id="issuer-ibge"
                      inputMode="numeric"
                      placeholder="3550308"
                      value={issuerCodigoMunicipio}
                      onChange={(e) => setIssuerCodigoMunicipio(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="issuer-rua">Logradouro</Label>
                    <Input
                      id="issuer-rua"
                      value={issuerAddressLogradouro}
                      onChange={(e) => setIssuerAddressLogradouro(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="issuer-num">Número</Label>
                    <Input
                      id="issuer-num"
                      value={issuerAddressNumero}
                      onChange={(e) => setIssuerAddressNumero(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="issuer-bairro">Bairro</Label>
                    <Input
                      id="issuer-bairro"
                      value={issuerAddressBairro}
                      onChange={(e) => setIssuerAddressBairro(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="issuer-cidade">Cidade</Label>
                    <Input
                      id="issuer-cidade"
                      value={issuerAddressCidade}
                      onChange={(e) => setIssuerAddressCidade(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="issuer-uf">UF</Label>
                    <Input
                      id="issuer-uf"
                      maxLength={2}
                      value={issuerAddressUf}
                      onChange={(e) => setIssuerAddressUf(e.target.value.toUpperCase())}
                    />
                  </div>
                </div>
                <div className="space-y-2 sm:max-w-xs">
                  <Label htmlFor="issuer-cep">CEP</Label>
                  <Input
                    id="issuer-cep"
                    inputMode="numeric"
                    placeholder="00000-000"
                    value={issuerAddressCep}
                    onChange={(e) => setIssuerAddressCep(e.target.value)}
                  />
                </div>
              </>
            )}

            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar dados fiscais
            </Button>
          </form>
        )}

        {isPj && !loading && (
          <div className="mt-6">
            <FiscalIssuerPanel enabled={isPj} reloadKey={issuerReloadKey} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
