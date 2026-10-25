"use client";

import { useState } from "react";
import { Loader2, Save, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updatePatientProfile } from "@/app/actions/patient";
import { ageLabelFromBirthAndAttendance } from "@/lib/patient-age";
import { PatientOptionalContactsFields } from "@/components/dashboard/PatientOptionalContactsFields";

type ProfileSaved = {
  name: string;
  age: string | null;
  dateOfBirth: string | null;
  diagnosis: string | null;
  history: string | null;
  phone: string | null;
  fatherName: string | null;
  motherName: string | null;
  companionName: string | null;
  companionPhone: string | null;
};

type Props = {
  patientId: string;
  name: string;
  age: string | null;
  dateOfBirth: string | null;
  diagnosis: string | null;
  history: string | null;
  phone: string | null;
  fatherName: string | null;
  motherName: string | null;
  companionName: string | null;
  companionPhone: string | null;
  onSaved: (next: ProfileSaved) => void;
};

export function PatientProfileEditPanel({
  patientId,
  name,
  age,
  dateOfBirth,
  diagnosis,
  history,
  phone,
  fatherName,
  motherName,
  companionName,
  companionPhone,
  onSaved,
}: Props) {
  const [nome, setNome] = useState(name);
  const [nascimento, setNascimento] = useState(dateOfBirth ?? "");
  const [idade, setIdade] = useState(
    ageLabelFromBirthAndAttendance(dateOfBirth, null) ?? age ?? "",
  );
  const [diagnostico, setDiagnostico] = useState(diagnosis ?? "");
  const [historico, setHistorico] = useState(history ?? "");
  const [telefone, setTelefone] = useState(phone ?? "");
  const [nomePai, setNomePai] = useState(fatherName ?? "");
  const [nomeMae, setNomeMae] = useState(motherName ?? "");
  const [nomeAcompanhante, setNomeAcompanhante] = useState(companionName ?? "");
  const [telefoneAcompanhante, setTelefoneAcompanhante] = useState(companionPhone ?? "");
  const [saving, setSaving] = useState(false);
  const idadeFromBirth = Boolean(nascimento);

  const handleBirthChange = (value: string) => {
    setNascimento(value);
    const derived = ageLabelFromBirthAndAttendance(value, null);
    if (derived) setIdade(derived);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await updatePatientProfile({
        patientId,
        name: nome,
        age: idade,
        dateOfBirth: nascimento,
        diagnosis: diagnostico,
        history: historico,
        telefone,
        nomePai,
        nomeMae,
        nomeAcompanhante,
        telefoneAcompanhante,
      });
      if (!result.success || !result.patient) {
        toast.error(result.error || "Não foi possível salvar o cadastro.");
        return;
      }
      onSaved(result.patient);
      toast.success("Cadastro do paciente atualizado.");
    } catch (error) {
      console.error(error);
      toast.error("Erro ao salvar o cadastro.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <UserRound className="h-5 w-5 text-primary" />
          Cadastro do paciente
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Informe a data de nascimento para a idade atualizar sozinha com o tempo e em cada
          evolução. Telefone e nomes de pai, mãe ou acompanhante são opcionais.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="patient-profile-name">Nome</Label>
              <Input
                id="patient-profile-name"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                minLength={2}
                maxLength={200}
                className="bg-card border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="patient-profile-dob">Data de nascimento</Label>
              <Input
                id="patient-profile-dob"
                type="date"
                value={nascimento}
                onChange={(e) => handleBirthChange(e.target.value)}
                className="bg-card border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="patient-profile-age">Idade</Label>
              <Input
                id="patient-profile-age"
                value={idade}
                onChange={(e) => setIdade(e.target.value)}
                maxLength={40}
                readOnly={idadeFromBirth}
                placeholder={idadeFromBirth ? "Calculada pela data de nascimento" : "Ex.: 42 anos"}
                className="bg-card border-border text-foreground"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="patient-profile-diagnosis">Diagnóstico / queixa principal</Label>
              <Input
                id="patient-profile-diagnosis"
                value={diagnostico}
                onChange={(e) => setDiagnostico(e.target.value)}
                maxLength={500}
                className="bg-card border-border text-foreground"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="patient-profile-history">Histórico clínico (resumo)</Label>
              <Textarea
                id="patient-profile-history"
                value={historico}
                onChange={(e) => setHistorico(e.target.value)}
                maxLength={8000}
                rows={6}
                className="bg-card border-border text-foreground"
              />
            </div>
          </div>
          <PatientOptionalContactsFields
            idPrefix="patient-profile"
            values={{ telefone, nomePai, nomeMae, nomeAcompanhante, telefoneAcompanhante }}
            onChange={(patch) => {
              if (patch.telefone !== undefined) setTelefone(patch.telefone);
              if (patch.nomePai !== undefined) setNomePai(patch.nomePai);
              if (patch.nomeMae !== undefined) setNomeMae(patch.nomeMae);
              if (patch.nomeAcompanhante !== undefined) setNomeAcompanhante(patch.nomeAcompanhante);
              if (patch.telefoneAcompanhante !== undefined) {
                setTelefoneAcompanhante(patch.telefoneAcompanhante);
              }
            }}
          />
          <Button type="submit" disabled={saving} className="gap-2">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Salvar cadastro
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
