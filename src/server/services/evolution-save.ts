import { z } from "zod";
import { saveEvolution, type SaveEvolutionInput } from "@/app/actions/patient";
import {
  medicationsAndSupplementsStoredSchema,
  patientHandoutStoredSchema,
  professionalActionsStoredSchema,
} from "@/lib/evolution-artifacts";
import type { ActiveIntraUser } from "@/lib/intra-user/patient-scope";

export const SaveEvolutionApiSchema = z.object({
  patientName: z.string().trim().min(1).max(200),
  patientAge: z.string().max(40).optional(),
  patientDateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  patientDiagnosis: z.string().max(2000).optional(),
  attendanceDate: z.string().max(30).optional(),
  content: z.string().trim().min(1).max(200_000),
  examsAnalysis: z.string().max(100_000).optional(),
  linkedPatientId: z.string().uuid().optional(),
  appointmentId: z.string().uuid().optional(),
  clinicalMeta: z.record(z.string(), z.string().max(4000).optional()).optional(),
  patientQueixa: z.string().max(4000).optional(),
  patientConduta: z.string().max(4000).optional(),
  telefone: z.string().max(40).optional(),
  nomePai: z.string().max(200).optional(),
  nomeMae: z.string().max(200).optional(),
  nomeAcompanhante: z.string().max(200).optional(),
  telefoneAcompanhante: z.string().max(40).optional(),
  professionalActions: professionalActionsStoredSchema.optional(),
  patientHandout: patientHandoutStoredSchema.optional(),
  medicationsAndSupplements: medicationsAndSupplementsStoredSchema.optional(),
});

export type SaveEvolutionApiInput = z.infer<typeof SaveEvolutionApiSchema>;

export type SaveEvolutionApiResult =
  | {
      success: true;
      evolutionId: string;
      patientId: string;
      isNewPatient: boolean;
      sessionConsumption?: import("@/lib/finance/evolution-session-consumption").EvolutionSessionConsumptionSummary;
    }
  | {
      success: false;
      error: string;
      planLimit?: boolean;
    };

export async function saveEvolutionForUser(
  dbUserId: string,
  input: SaveEvolutionApiInput,
  activeIntraUser?: ActiveIntraUser | null,
): Promise<SaveEvolutionApiResult> {
  const payload: SaveEvolutionInput = {
    patientName: input.patientName,
    patientAge: input.patientAge,
    patientDateOfBirth: input.patientDateOfBirth,
    patientDiagnosis: input.patientDiagnosis,
    patientQueixa: input.patientQueixa,
    patientConduta: input.patientConduta,
    telefone: input.telefone,
    nomePai: input.nomePai,
    nomeMae: input.nomeMae,
    nomeAcompanhante: input.nomeAcompanhante,
    telefoneAcompanhante: input.telefoneAcompanhante,
    attendanceDate: input.attendanceDate,
    content: input.content,
    examsAnalysis: input.examsAnalysis,
    linkedPatientId: input.linkedPatientId,
    appointmentId: input.appointmentId,
    clinicalMeta: input.clinicalMeta,
    professionalActions: input.professionalActions,
    patientHandout: input.patientHandout,
    medicationsAndSupplements: input.medicationsAndSupplements,
  };

  const result = await saveEvolution(payload, {
    dbUserId,
    activeIntraUser: activeIntraUser ?? null,
  });

  if (!result.success) {
    const planLimit =
      typeof result.error === "string" &&
      result.error.toLowerCase().includes("limite de evoluções");
    return {
      success: false,
      error: result.error ?? "Erro ao salvar evolução.",
      planLimit,
    };
  }

  if (!result.evolutionId || !result.patientId) {
    return { success: false, error: "Resposta incompleta ao salvar evolução." };
  }

  return {
    success: true,
    evolutionId: result.evolutionId,
    patientId: result.patientId,
    isNewPatient: result.isNewPatient === true,
    sessionConsumption: result.sessionConsumption,
  };
}
