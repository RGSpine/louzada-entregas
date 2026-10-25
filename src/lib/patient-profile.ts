import { z } from "zod";

/** Schema do cadastro clínico editável na ficha do paciente. */
export const updatePatientProfileSchema = z.object({
  patientId: z.string().uuid(),
  name: z.string().trim().min(2, "Informe o nome do paciente.").max(200),
  age: z.string().trim().max(40).optional().nullable(),
  dateOfBirth: z
    .union([
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de nascimento inválida."),
      z.literal(""),
      z.null(),
    ])
    .optional(),
  diagnosis: z.string().trim().max(500).optional().nullable(),
  history: z.string().trim().max(8000).optional().nullable(),
  telefone: z.string().trim().max(40).optional().nullable(),
  nomePai: z.string().trim().max(200).optional().nullable(),
  nomeMae: z.string().trim().max(200).optional().nullable(),
  nomeAcompanhante: z.string().trim().max(200).optional().nullable(),
  telefoneAcompanhante: z.string().trim().max(40).optional().nullable(),
});

export type UpdatePatientProfileInput = z.infer<typeof updatePatientProfileSchema>;

export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Data de atendimento no formato do PDF nativo (DD/MM/AAAA). */
export function formatEvolutionAttendanceDatePtBr(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
