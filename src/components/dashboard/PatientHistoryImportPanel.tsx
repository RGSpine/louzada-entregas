"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileUp,
  FolderInput,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  analyzePatientHistoryImport,
  commitPatientExistingHistoryImport,
  commitPatientHistoryImport,
  getHistoryImportQuota,
} from "@/app/actions/patient-history-import";
import {
  isImportSessionDate,
  MAX_HISTORY_IMPORT_FILE_BYTES,
  MAX_HISTORY_IMPORT_FILES,
  type HistoryImportPreview,
  type HistoryImportSession,
} from "@/lib/patient-history-import";
import { detectPlanLimitKindFromError, type PlanLimitKind } from "@/lib/plan-limit-upgrade";
import { PatientOptionalContactsFields } from "@/components/dashboard/PatientOptionalContactsFields";
import { contactsToFormFields } from "@/lib/patient-optional-contacts";

type Props = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onPlanLimitHit?: (kind: PlanLimitKind) => void;
  /** create = cadastra paciente novo; attach = anexa à ficha aberta. */
  variant?: "create" | "attach";
  patientId?: string;
  patientName?: string;
  onAttached?: () => void;
};

function formatQuota(used: number, limit: number | null | undefined): string {
  if (limit == null) return `${used} usadas este mês (ilimitado)`;
  return `${used}/${limit} importações este mês`;
}

export function PatientHistoryImportPanel({
  enabled,
  onEnabledChange,
  onPlanLimitHit,
  variant = "create",
  patientId,
  patientName,
  onAttached,
}: Props) {
  const isAttach = variant === "attach";
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<HistoryImportPreview | null>(null);
  const [quotaUsed, setQuotaUsed] = useState(0);
  const [quotaLimit, setQuotaLimit] = useState<number | null>(null);
  const [canImport, setCanImport] = useState(true);

  const refreshQuota = useCallback(() => {
    void getHistoryImportQuota().then((res) => {
      if (!res.success) return;
      setQuotaUsed(res.used ?? 0);
      setQuotaLimit(res.limit ?? null);
      setCanImport(res.canImport !== false);
    });
  }, []);

  useEffect(() => {
    if (enabled) refreshQuota();
  }, [enabled, refreshQuota]);

  const handleToggle = (next: boolean) => {
    onEnabledChange(next);
    if (!next) {
      setPreview(null);
      setFiles([]);
      setFileInputKey((k) => k + 1);
    }
  };

  const handleFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const incoming = Array.from(list);
    const next: File[] = [...files];
    for (const f of incoming) {
      if (next.length >= MAX_HISTORY_IMPORT_FILES) {
        toast.error(`Máximo de ${MAX_HISTORY_IMPORT_FILES} ficheiros por importação.`);
        break;
      }
      if (f.size > MAX_HISTORY_IMPORT_FILE_BYTES) {
        toast.error(
          `${f.name} excede ${Math.round(MAX_HISTORY_IMPORT_FILE_BYTES / (1024 * 1024))} MB.`,
        );
        continue;
      }
      next.push(f);
    }
    setFiles(next);
    setFileInputKey((k) => k + 1);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const updateSession = (index: number, patch: Partial<HistoryImportSession>) => {
    setPreview((prev) => {
      if (!prev) return prev;
      const sessions = prev.sessions.map((s, i) =>
        i === index ? { ...s, ...patch } : s,
      );
      return { ...prev, sessions };
    });
  };

  const patchPreviewContacts = (patch: {
    telefone?: string | null;
    nomePai?: string | null;
    nomeMae?: string | null;
    nomeAcompanhante?: string | null;
    telefoneAcompanhante?: string | null;
  }) => {
    setPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        patient: {
          ...prev.patient,
          phone: patch.telefone !== undefined ? patch.telefone || null : prev.patient.phone,
          fatherName:
            patch.nomePai !== undefined ? patch.nomePai || null : prev.patient.fatherName,
          motherName:
            patch.nomeMae !== undefined ? patch.nomeMae || null : prev.patient.motherName,
          companionName:
            patch.nomeAcompanhante !== undefined
              ? patch.nomeAcompanhante || null
              : prev.patient.companionName,
          companionPhone:
            patch.telefoneAcompanhante !== undefined
              ? patch.telefoneAcompanhante || null
              : prev.patient.companionPhone,
        },
      };
    });
  };

  const removeSession = (index: number) => {
    setPreview((prev) => {
      if (!prev) return prev;
      const sessions = prev.sessions.filter((_, i) => i !== index);
      return { ...prev, sessions };
    });
  };

  const handleAnalyze = async () => {
    if (files.length === 0) {
      toast.error("Anexe os documentos do prontuário/evoluções.");
      return;
    }
    if (!canImport) {
      toast.error("Limite mensal de importações atingido no seu plano.");
      onPlanLimitHit?.("historyImports");
      return;
    }

    setAnalyzing(true);
    setPreview(null);
    try {
      const formData = new FormData();
      formData.set("platform", "OUTRO");
      if (isAttach && patientName) {
        formData.set("existingPatientName", patientName);
      }
      for (const f of files) {
        formData.append("files", f);
      }
      const res = await analyzePatientHistoryImport(formData);
      if (!res.success || !res.preview) {
        const kind = detectPlanLimitKindFromError(res.error || "");
        if (kind) onPlanLimitHit?.(kind);
        toast.error(res.error || "Falha ao analisar documentos.");
        return;
      }
      setPreview(res.preview);
      if (res.importsUsed != null) setQuotaUsed(res.importsUsed);
      if (res.importsLimit !== undefined) setQuotaLimit(res.importsLimit ?? null);
      toast.success(
        `Histórico identificado: ${res.preview.sessions.length} evolução(ões). Revise antes de confirmar.`,
      );
    } catch (err) {
      console.error(err);
      toast.error("Erro inesperado ao analisar.");
    } finally {
      setAnalyzing(false);
    }
  };

  const sessionsMissingDate = preview
    ? preview.sessions.filter((s) => !isImportSessionDate(s.date)).length
    : 0;

  const applyDateToUndated = (date: string) => {
    if (!isImportSessionDate(date)) return;
    setPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sessions: prev.sessions.map((s) =>
          isImportSessionDate(s.date) ? s : { ...s, date },
        ),
      };
    });
  };

  const handleCommit = async () => {
    if (!preview) return;
    if (preview.sessions.length === 0) {
      toast.error("Mantenha ao menos uma evolução no histórico.");
      return;
    }

    if (isAttach) {
      if (!patientId) {
        toast.error("Paciente inválido.");
        return;
      }
      if (sessionsMissingDate > 0) {
        toast.error(
          `Informe a data das ${sessionsMissingDate} evolução(ões) sem data extraída.`,
        );
        return;
      }

      setCommitting(true);
      try {
        const res = await commitPatientExistingHistoryImport({
          patientId,
          platform: "OUTRO",
          sessions: preview.sessions.map((s) => ({
            date: s.date as string,
            title: s.title || null,
            content: s.content,
          })),
          patient: {
            phone: preview.patient.phone || null,
            fatherName: preview.patient.fatherName || null,
            motherName: preview.patient.motherName || null,
            companionName: preview.patient.companionName || null,
            companionPhone: preview.patient.companionPhone || null,
          },
        });

        if (!res.success) {
          const kind = detectPlanLimitKindFromError(res.error || "");
          if (kind) onPlanLimitHit?.(kind);
          toast.error(res.error || "Falha ao importar evoluções.");
          return;
        }

        toast.success(
          `${res.evolutionCount} evolução(ões) importadas e organizadas por data na ficha.`,
        );
        refreshQuota();
        setPreview(null);
        setFiles([]);
        setFileInputKey((k) => k + 1);
        onAttached?.();
        onEnabledChange(false);
      } catch (err) {
        console.error(err);
        toast.error("Erro inesperado ao confirmar importação.");
      } finally {
        setCommitting(false);
      }
      return;
    }

    if (!preview.patient.name.trim()) {
      toast.error("Informe o nome do paciente.");
      return;
    }

    setCommitting(true);
    try {
      const res = await commitPatientHistoryImport({
        platform: "OUTRO",
        patient: {
          name: preview.patient.name.trim(),
          age: preview.patient.age || null,
          diagnosis: preview.patient.diagnosis || null,
          history: preview.patient.history || null,
          phone: preview.patient.phone || null,
          fatherName: preview.patient.fatherName || null,
          motherName: preview.patient.motherName || null,
          companionName: preview.patient.companionName || null,
          companionPhone: preview.patient.companionPhone || null,
        },
        sessions: preview.sessions.map((s) => ({
          date: s.date || null,
          title: s.title || null,
          content: s.content,
        })),
      });

      if (!res.success) {
        const kind = detectPlanLimitKindFromError(res.error || "");
        if (kind) onPlanLimitHit?.(kind);
        toast.error(res.error || "Falha ao cadastrar.");
        return;
      }

      toast.success(
        `${res.patientName} cadastrado(a) com ${res.evolutionCount} evolução(ões) importadas.`,
      );
      refreshQuota();
      if (res.patientId) {
        router.push(`/dashboard/patients/${res.patientId}?tab=cadastro`);
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro inesperado ao confirmar importação.");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Card className="bg-card/50 border-border w-full mt-4">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <Label className="text-foreground/90 text-xl font-semibold flex items-center gap-2">
              <FolderInput className="h-5 w-5 text-primary shrink-0" />
              {isAttach
                ? "Importar evoluções para esta ficha"
                : "Importar paciente de outra plataforma"}
            </Label>
            <p className="text-sm text-muted-foreground">
              {isAttach
                ? `Envie uma evolução avulsa ou várias de uma vez. A IA extrai as datas; se faltar, informe você. Elas entram no histórico de ${patientName || "este paciente"}, junto com as demais, ordenadas por data.`
                : "A Louzada Entregas não tem vínculo direto com outras plataformas. Baixe as evoluções e o prontuário em PDF no sistema de origem e envie-os aqui para cadastrar o paciente com histórico contínuo."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => handleToggle(!enabled)}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              enabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${
                enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {enabled && (
          <div className="space-y-4 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              {formatQuota(quotaUsed, quotaLimit)} · até {MAX_HISTORY_IMPORT_FILES} ficheiros
              (PDF/imagem), {Math.round(MAX_HISTORY_IMPORT_FILE_BYTES / (1024 * 1024))} MB cada
            </p>

            {!canImport && (
              <p className="text-sm text-destructive">
                Limite mensal de importações atingido. Faça upgrade ou aguarde o próximo mês.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="historyImportFiles">
                Documentos do prontuário / evoluções
                {files.length > 0 && (
                  <span className="text-muted-foreground ml-2 font-normal">
                    ({files.length}/{MAX_HISTORY_IMPORT_FILES})
                  </span>
                )}
              </Label>

              {files.length > 0 && (
                <ul className="space-y-2">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between gap-2 rounded border border-border bg-muted p-2"
                    >
                      <span className="truncate text-sm text-foreground">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="text-destructive shrink-0"
                        aria-label={`Remover ${file.name}`}
                      >
                        <X size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <Input
                key={fileInputKey}
                id="historyImportFiles"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                multiple
                disabled={files.length >= MAX_HISTORY_IMPORT_FILES || analyzing || committing}
                onChange={(e) => handleFiles(e.target.files)}
                className="bg-card border-border text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-white cursor-pointer"
              />
            </div>

            {!preview && (
              <Button
                type="button"
                onClick={() => void handleAnalyze()}
                disabled={analyzing || files.length === 0 || !canImport}
                className="w-full gap-2"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Analisando histórico…
                  </>
                ) : (
                  <>
                    <FileUp className="h-5 w-5" />
                    Analisar e montar histórico ({files.length}{" "}
                    {files.length === 1 ? "arquivo" : "arquivos"})
                  </>
                )}
              </Button>
            )}

            {preview && (
              <div className="space-y-4">
                {!isAttach ? (
                <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
                  <p className="text-sm font-semibold text-foreground">
                    Dados do paciente (editáveis)
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor="importPatientName">Nome</Label>
                      <Input
                        id="importPatientName"
                        value={preview.patient.name}
                        onChange={(e) =>
                          setPreview({
                            ...preview,
                            patient: { ...preview.patient, name: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="importPatientAge">Idade</Label>
                      <Input
                        id="importPatientAge"
                        value={preview.patient.age ?? ""}
                        onChange={(e) =>
                          setPreview({
                            ...preview,
                            patient: {
                              ...preview.patient,
                              age: e.target.value || null,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="importPatientDx">Diagnóstico</Label>
                      <Input
                        id="importPatientDx"
                        value={preview.patient.diagnosis ?? ""}
                        onChange={(e) =>
                          setPreview({
                            ...preview,
                            patient: {
                              ...preview.patient,
                              diagnosis: e.target.value || null,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor="importPatientHistory">Histórico (ficha)</Label>
                      <Textarea
                        id="importPatientHistory"
                        rows={3}
                        value={preview.patient.history ?? ""}
                        onChange={(e) =>
                          setPreview({
                            ...preview,
                            patient: {
                              ...preview.patient,
                              history: e.target.value || null,
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                  <PatientOptionalContactsFields
                    idPrefix="import-patient"
                    values={contactsToFormFields(preview.patient)}
                    onChange={patchPreviewContacts}
                  />
                  {preview.notes ? (
                    <p className="text-xs text-muted-foreground">
                      Nota da IA: {preview.notes}
                    </p>
                  ) : null}
                </div>
                ) : (
                  <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
                    <p className="text-sm font-semibold text-foreground">
                      Contatos extraídos (só preenchem o que estiver vazio na ficha)
                    </p>
                    <PatientOptionalContactsFields
                      idPrefix="import-attach"
                      values={contactsToFormFields(preview.patient)}
                      onChange={patchPreviewContacts}
                    />
                    {preview.notes ? (
                      <p className="text-xs text-muted-foreground">
                        Nota da IA: {preview.notes}
                      </p>
                    ) : null}
                  </div>
                )}

                <div className="space-y-3">
                  <p className="text-sm font-semibold text-foreground">
                    Evoluções a cadastrar ({preview.sessions.length})
                  </p>
                  {isAttach && sessionsMissingDate > 0 ? (
                    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
                      <p className="text-sm text-foreground">
                        {sessionsMissingDate} evolução(ões) sem data extraída. Informe no
                        campo de cada uma ou aplique a mesma data às que faltam.
                      </p>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1">
                          <Label htmlFor="undatedBatchDate">Data para as sem data</Label>
                          <Input
                            id="undatedBatchDate"
                            type="date"
                            onChange={(e) => applyDateToUndated(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {preview.sessions.map((session, index) => (
                    <div
                      key={index}
                      className="rounded-lg border border-border bg-card p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1 flex-1 min-w-[8rem]">
                          <Label>Data {isAttach ? "(obrigatória)" : "(AAAA-MM-DD)"}</Label>
                          <Input
                            type="date"
                            value={session.date ?? ""}
                            placeholder="2024-03-15"
                            onChange={(e) =>
                              updateSession(index, {
                                date: e.target.value || null,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1 flex-[2] min-w-[10rem]">
                          <Label>Título</Label>
                          <Input
                            value={session.title ?? ""}
                            onChange={(e) =>
                              updateSession(index, {
                                title: e.target.value || null,
                              })
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => removeSession(index)}
                          aria-label="Remover evolução"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <Textarea
                        rows={5}
                        value={session.content}
                        onChange={(e) =>
                          updateSession(index, { content: e.target.value })
                        }
                      />
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    disabled={analyzing || committing}
                    onClick={() => {
                      setPreview(null);
                    }}
                  >
                    Voltar e reanalisar
                  </Button>
                  <Button
                    type="button"
                    className="flex-1 gap-2"
                    disabled={committing || (isAttach && sessionsMissingDate > 0)}
                    onClick={() => void handleCommit()}
                  >
                    {committing ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        {isAttach ? "Importando…" : "Cadastrando…"}
                      </>
                    ) : isAttach ? (
                      <>
                        Confirmar e juntar ao histórico (
                        {preview.sessions.length}{" "}
                        {preview.sessions.length === 1 ? "evolução" : "evoluções"})
                      </>
                    ) : (
                      <>
                        Confirmar e cadastrar paciente (
                        {preview.sessions.length} evoluções)
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
