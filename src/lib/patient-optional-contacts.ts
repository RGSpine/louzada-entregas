/**
 * Contatos opcionais da ficha (telefone, pais, acompanhante).
 * Extraídos pela IA no áudio/documento e editáveis no cadastro / evolução.
 */

export const PATIENT_OPTIONAL_NAME_MAX = 200;
export const PATIENT_OPTIONAL_PHONE_MAX = 40;

export type PatientOptionalContacts = {
  phone: string | null;
  fatherName: string | null;
  motherName: string | null;
  companionName: string | null;
  companionPhone: string | null;
};

export type PatientOptionalContactsInput = {
  telefone?: string | null;
  nomePai?: string | null;
  nomeMae?: string | null;
  nomeAcompanhante?: string | null;
  telefoneAcompanhante?: string | null;
};

function clip(raw: string | null | undefined, max: number): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

export function sanitizeOptionalPhone(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const cleaned = t.replace(/[^\d+()\-\s]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > PATIENT_OPTIONAL_PHONE_MAX
    ? cleaned.slice(0, PATIENT_OPTIONAL_PHONE_MAX)
    : cleaned;
}

export function sanitizeOptionalName(raw: string | null | undefined): string | null {
  return clip(raw, PATIENT_OPTIONAL_NAME_MAX);
}

export function parseOptionalContactsFromAi(
  raw: Record<string, unknown> | null | undefined,
): PatientOptionalContactsInput {
  const str = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const v = raw?.[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };
  return {
    telefone: str("telefone", "phone"),
    nomePai: str("nomePai", "fatherName"),
    nomeMae: str("nomeMae", "motherName"),
    nomeAcompanhante: str("nomeAcompanhante", "companionName"),
    telefoneAcompanhante: str("telefoneAcompanhante", "companionPhone"),
  };
}

export function emptyContactsForm(): Required<PatientOptionalContactsInput> {
  return {
    telefone: "",
    nomePai: "",
    nomeMae: "",
    nomeAcompanhante: "",
    telefoneAcompanhante: "",
  };
}

export function contactsToFormFields(
  c: Partial<PatientOptionalContacts> | null | undefined,
): Required<PatientOptionalContactsInput> {
  return {
    telefone: c?.phone ?? "",
    nomePai: c?.fatherName ?? "",
    nomeMae: c?.motherName ?? "",
    nomeAcompanhante: c?.companionName ?? "",
    telefoneAcompanhante: c?.companionPhone ?? "",
  };
}

/** Formulário: valor já preenchido prevalece; IA só completa vazio. */
export function mergeFormContactsKeepExisting(
  prev: PatientOptionalContactsInput,
  incoming: PatientOptionalContactsInput,
): Required<PatientOptionalContactsInput> {
  const pick = (a?: string | null, b?: string | null) =>
    (a ?? "").trim() || (b ?? "").trim() || "";
  return {
    telefone: pick(prev.telefone, incoming.telefone),
    nomePai: pick(prev.nomePai, incoming.nomePai),
    nomeMae: pick(prev.nomeMae, incoming.nomeMae),
    nomeAcompanhante: pick(prev.nomeAcompanhante, incoming.nomeAcompanhante),
    telefoneAcompanhante: pick(prev.telefoneAcompanhante, incoming.telefoneAcompanhante),
  };
}

export function contactsFromEnglishDraft(draft: {
  phone?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  companionName?: string | null;
  companionPhone?: string | null;
}): PatientOptionalContacts {
  return contactsFromProfileForm({
    telefone: draft.phone,
    nomePai: draft.fatherName,
    nomeMae: draft.motherName,
    nomeAcompanhante: draft.companionName,
    telefoneAcompanhante: draft.companionPhone,
  });
}

/** Evolução/IA: valor novo só preenche vazio; não apaga o que já está na ficha. */
export function mergeOptionalContactsKeepExisting(
  incoming: PatientOptionalContactsInput | undefined,
  existing: PatientOptionalContacts | null | undefined,
): PatientOptionalContacts {
  const pickName = (next?: string | null, prev?: string | null) =>
    sanitizeOptionalName(next) ?? sanitizeOptionalName(prev);
  const pickPhone = (next?: string | null, prev?: string | null) =>
    sanitizeOptionalPhone(next) ?? sanitizeOptionalPhone(prev);
  return {
    phone: pickPhone(incoming?.telefone, existing?.phone),
    fatherName: pickName(incoming?.nomePai, existing?.fatherName),
    motherName: pickName(incoming?.nomeMae, existing?.motherName),
    companionName: pickName(incoming?.nomeAcompanhante, existing?.companionName),
    companionPhone: pickPhone(incoming?.telefoneAcompanhante, existing?.companionPhone),
  };
}

/** Cadastro: o formulário manda o valor final (vazio = limpar). */
export function contactsFromProfileForm(
  input: PatientOptionalContactsInput,
): PatientOptionalContacts {
  return {
    phone: sanitizeOptionalPhone(input.telefone),
    fatherName: sanitizeOptionalName(input.nomePai),
    motherName: sanitizeOptionalName(input.nomeMae),
    companionName: sanitizeOptionalName(input.nomeAcompanhante),
    companionPhone: sanitizeOptionalPhone(input.telefoneAcompanhante),
  };
}

export const PATIENT_OPTIONAL_CONTACTS_JSON_FIELDS = `"telefone": "string ou vazio (paciente)",
  "nomePai": "string ou vazio",
  "nomeMae": "string ou vazio",
  "nomeAcompanhante": "string ou vazio (responsavel/acompanhante para contato)",
  "telefoneAcompanhante": "string ou vazio"`;

export const PATIENT_OPTIONAL_CONTACTS_PROMPT_RULE = `CAMPOS OPCIONAIS DE CONTATO (nao invente):
- telefone: numero do PACIENTE se dito ou legivel no documento.
- nomePai / nomeMae: so se mencionados (pai, mae, genitor).
- nomeAcompanhante: quem veio junto ou e contato (avo, tio, cuidador, responsavel) — nao duplique pai/mae se ja preenchidos nesses campos.
- telefoneAcompanhante: telefone desse contato, se distinto do paciente.
- Se a informacao nao existir, use string vazia.`;
