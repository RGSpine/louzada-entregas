"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PATIENT_OPTIONAL_NAME_MAX,
  PATIENT_OPTIONAL_PHONE_MAX,
  type PatientOptionalContactsInput,
} from "@/lib/patient-optional-contacts";

type Props = {
  idPrefix: string;
  values: PatientOptionalContactsInput;
  onChange: (patch: Partial<PatientOptionalContactsInput>) => void;
};

export function PatientOptionalContactsFields({ idPrefix, values, onChange }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-telefone`}>Telefone do paciente</Label>
        <Input
          id={`${idPrefix}-telefone`}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={PATIENT_OPTIONAL_PHONE_MAX}
          placeholder="Opcional"
          value={values.telefone ?? ""}
          onChange={(e) => onChange({ telefone: e.target.value })}
          className="bg-card border-border text-foreground"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-telefone-acomp`}>Telefone do acompanhante</Label>
        <Input
          id={`${idPrefix}-telefone-acomp`}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={PATIENT_OPTIONAL_PHONE_MAX}
          placeholder="Opcional"
          value={values.telefoneAcompanhante ?? ""}
          onChange={(e) => onChange({ telefoneAcompanhante: e.target.value })}
          className="bg-card border-border text-foreground"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-pai`}>Nome do pai</Label>
        <Input
          id={`${idPrefix}-pai`}
          maxLength={PATIENT_OPTIONAL_NAME_MAX}
          placeholder="Opcional"
          value={values.nomePai ?? ""}
          onChange={(e) => onChange({ nomePai: e.target.value })}
          className="bg-card border-border text-foreground"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-mae`}>Nome da mãe</Label>
        <Input
          id={`${idPrefix}-mae`}
          maxLength={PATIENT_OPTIONAL_NAME_MAX}
          placeholder="Opcional"
          value={values.nomeMae ?? ""}
          onChange={(e) => onChange({ nomeMae: e.target.value })}
          className="bg-card border-border text-foreground"
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-acomp`}>Acompanhante / responsável para contato</Label>
        <Input
          id={`${idPrefix}-acomp`}
          maxLength={PATIENT_OPTIONAL_NAME_MAX}
          placeholder="Opcional — avó, tio, cuidador…"
          value={values.nomeAcompanhante ?? ""}
          onChange={(e) => onChange({ nomeAcompanhante: e.target.value })}
          className="bg-card border-border text-foreground"
        />
      </div>
    </div>
  );
}
