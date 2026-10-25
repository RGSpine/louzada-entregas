import { createHash } from "crypto";
import type { FiscalRegime } from "@prisma/client";

export const RECEITA_SAUDE_INCOME_CODE = "R01.001.001";
export const RECEITA_SAUDE_MAX_LINES = 1000;

export interface ReceitaSaudeExportRowInput {
  transactionId: string;
  occurredAt: Date;
  amountCents: number;
  description: string | null;
  patientCpf: string;
  patientPayerCpf: string | null;
  professionalCpf: string;
  occupationCode: string;
  councilNumber: string | null;
}

export interface ReceitaSaudeBuildResult {
  csv: string;
  lineCount: number;
  calendarYear: number;
  contentHash: string;
}

function formatPaymentDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatAmountBr(cents: number): string {
  const value = cents / 100;
  return value.toFixed(2).replace(".", ",");
}

function sanitizeDescription(raw: string | null): string {
  const base = (raw ?? "Serviços de saúde").trim() || "Serviços de saúde";
  return base.slice(0, 255).replace(/;/g, ",");
}

function escapeCsvField(value: string): string {
  if (/[;\n\r"]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildReceitaSaudeCsvLine(input: ReceitaSaudeExportRowInput): string {
  const payerCpf = input.patientPayerCpf ?? input.patientCpf;
  const council = (input.councilNumber ?? "").trim().slice(0, 15);

  const fields = [
    formatPaymentDate(input.occurredAt),
    RECEITA_SAUDE_INCOME_CODE,
    input.occupationCode,
    formatAmountBr(input.amountCents),
    "",
    sanitizeDescription(input.description),
    "PF",
    payerCpf,
    input.patientCpf,
    "",
    "",
    "",
    "",
    "S",
    input.professionalCpf,
    council,
  ];

  return fields.map(escapeCsvField).join(";");
}

export function buildReceitaSaudeCsv(rows: ReceitaSaudeExportRowInput[]): ReceitaSaudeBuildResult {
  if (rows.length === 0) {
    throw new Error("Nenhuma receita selecionada.");
  }
  if (rows.length > RECEITA_SAUDE_MAX_LINES) {
    throw new Error(`Máximo de ${RECEITA_SAUDE_MAX_LINES} linhas por arquivo.`);
  }

  const years = new Set(rows.map((r) => r.occurredAt.getFullYear()));
  if (years.size !== 1) {
    throw new Error("Todas as receitas devem ser do mesmo ano-calendário.");
  }

  const lines = rows.map(buildReceitaSaudeCsvLine);
  const body = lines.join("\r\n");
  const csv = `\uFEFF${body}`;
  const contentHash = createHash("sha256").update(body, "utf8").digest("hex");

  return {
    csv,
    lineCount: lines.length,
    calendarYear: [...years][0]!,
    contentHash,
  };
}

export function computeExportContentHash(input: ReceitaSaudeExportRowInput): string {
  return buildReceitaSaudeCsv([input]).contentHash;
}

export function isPfCarneLeaoRegime(regime: FiscalRegime): boolean {
  return regime === "PF_CARNE_LEAO";
}

export const FISCAL_EXTERNAL_LINKS = {
  carneLeaoWeb:
    "https://www.gov.br/pt-br/servicos/obter-autorizacao-para-acesso-ao-carne-leao-web",
  receitaSaudeFaq:
    "https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/auditoria-fiscal/conformidade/perguntas-e-respostas-receita-saude",
  receitaFederalAppIos:
    "https://apps.apple.com/br/app/receita-federal/id978472238",
  receitaFederalAppAndroid:
    "https://play.google.com/store/apps/details?id=br.gov.economia.receita.rfb",
} as const;
