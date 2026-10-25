"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Loader2,
  Upload,
  Trash2,
  FileText,
  ImageIcon,
  Sparkles,
  Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  listPatientExams,
  uploadPatientExam,
  deletePatientExam,
  type PatientExamSummary,
} from "@/app/actions/patient-exams";

interface PatientExamFolderProps {
  patientId: string;
  /** Lista e eliminação: FREE+ (via server action) */
  tabAllowed: boolean;
  /** Upload manual “Enviar arquivo”: apenas PRO */
  canUploadManual: boolean;
  /** Exibe aviso de quota de documentos por IA (apenas plano BASICO) */
  isFreePlan?: boolean;
}

function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

function suggestedFileName(exam: PatientExamSummary): string {
  const base = (exam.title || (isImageMime(exam.fileType) ? "imagem" : "documento"))
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim()
    .slice(0, 120);
  const ft = exam.fileType.toLowerCase();
  const ext = ft.includes("pdf")
    ? ".pdf"
    : ft.includes("png")
      ? ".png"
      : ft.includes("webp")
        ? ".webp"
        : ft.includes("gif")
          ? ".gif"
          : ".jpg";
  const stem = base || "documento";
  return stem.toLowerCase().endsWith(ext) ? stem : `${stem}${ext}`;
}

async function downloadAndOpenExam(exam: PatientExamSummary): Promise<void> {
  const fileName = suggestedFileName(exam);
  try {
    const res = await fetch(exam.fileUrl, { mode: "cors" });
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch {
    window.open(exam.fileUrl, "_blank", "noopener,noreferrer");
    toast.info(
      "Abriu numa nova separador. Em telemóvel, use o menu do browser para guardar o ficheiro."
    );
  }
}

export function PatientExamFolder({
  patientId,
  tabAllowed,
  canUploadManual,
  isFreePlan = false,
}: PatientExamFolderProps) {
  const [exams, setExams] = useState<PatientExamSummary[]>([]);
  const [loading, setLoading] = useState(tabAllowed);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!tabAllowed) return;
    setLoading(true);
    try {
      const result = await listPatientExams(patientId);
      if (!result.success) {
        toast.error(result.error || "Erro ao carregar exames");
        setExams([]);
        return;
      }
      setExams(result.exams ?? []);
    } finally {
      setLoading(false);
    }
  }, [tabAllowed, patientId]);

  useEffect(() => {
    if (tabAllowed) {
      void refresh();
    }
  }, [tabAllowed, refresh]);

  const handlePickFile = () => fileRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !tabAllowed || !canUploadManual) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("patientId", patientId);
      fd.append("file", file);
      if (title.trim()) fd.append("title", title.trim());

      const result = await uploadPatientExam(fd);
      if (!result.success) {
        toast.error(result.error || "Falha no envio");
        return;
      }
      toast.success("Arquivo enviado");
      setTitle("");
      if (result.exam) {
        setExams((prev) => [result.exam!, ...prev]);
      } else {
        await refresh();
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const result = await deletePatientExam(deleteId);
      if (!result.success) {
        toast.error(result.error || "Erro ao remover");
        return;
      }
      toast.success("Exame removido");
      setExams((prev) => prev.filter((x) => x.id !== deleteId));
      setDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  if (!tabAllowed) {
    return (
      <Card className="bg-card border-border mb-8">
        <CardHeader className="pb-2">
          <CardTitle className="text-foreground flex items-center gap-2 flex-wrap">
            <FolderOpen className="h-5 w-5 text-success" />
            Exames / Documentos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Não foi possível carregar a pasta de documentos. Atualize a página ou volte a iniciar sessão.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-card border-border mb-8">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-foreground flex items-center gap-2 flex-wrap">
              <FolderOpen className="h-5 w-5 text-success" />
              Exames / Documentos
              <Badge className="bg-clinical/15 text-clinical border-clinical/30 text-xs">
                Todos os planos
              </Badge>
            </CardTitle>
            {canUploadManual ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Título opcional"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="max-w-[220px] bg-background border-border"
                  disabled={uploading}
                />
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,image/jpeg,image/png,image/webp,image/gif,application/pdf"
                  onChange={handleFileChange}
                />
                <Button
                  type="button"
                  onClick={handlePickFile}
                  disabled={uploading}
                  className="gap-2 bg-success hover:bg-success/90"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Enviar arquivo
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground max-w-md">
                <Badge className="mr-2 border-success/30 bg-success/15 text-success">
                  PRO
                </Badge>
                Envio manual de ficheiros (PDF/imagem) está disponível no plano PREMIUM. Documentos
                gerados por IA aparecem aqui em todos os planos.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            PDF ou imagem, até 8 MB.
            {isFreePlan ? " Plano BASICO: até 5 documentos gerados por IA." : null}
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando…
            </div>
          ) : exams.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              Nenhum arquivo nesta pasta ainda.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {exams.map((exam) => (
                <div
                  key={exam.id}
                  className="flex flex-col rounded-xl border border-border bg-muted/80 dark:bg-muted/40 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="relative aspect-square bg-muted dark:bg-card shrink-0">
                    {isImageMime(exam.fileType) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={exam.fileUrl}
                        alt={exam.title || "Exame"}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
                        <FileText className="h-12 w-12 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          PDF
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-2.5 min-w-0 flex-1 flex flex-col gap-1">
                    <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">
                      {exam.source === "AI_GENERATED" && (
                        <Badge className="mr-1 border-success/30 bg-success/20 px-1 py-0 text-[9px] text-success">
                          IA
                        </Badge>
                      )}
                      {exam.title || (isImageMime(exam.fileType) ? "Imagem" : "Documento")}
                    </p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      {isImageMime(exam.fileType) ? (
                        <ImageIcon className="h-3 w-3 shrink-0" />
                      ) : (
                        <FileText className="h-3 w-3 shrink-0" />
                      )}
                      <span className="truncate">{exam.fileType}</span>
                      <span className="mx-0.5">·</span>
                      <span className="shrink-0">
                        {new Date(exam.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                    </p>
                    {exam.aiSummary ? (
                      <div className="mt-1 pt-1.5 border-t border-border dark:border-border">
                        <p className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-success">
                          <Sparkles className="h-3 w-3" />
                          IA
                        </p>
                        <p className="text-[11px] text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                          {exam.aiSummary}
                        </p>
                      </div>
                    ) : null}
                    <div className="mt-auto pt-2 flex gap-1.5">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="flex-1 h-9 text-xs gap-1 bg-clinical hover:bg-clinical/90 min-w-0 px-2"
                        onClick={() => void downloadAndOpenExam(exam)}
                      >
                        <Download className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Baixar e abrir</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 border-border dark:border-border"
                        onClick={() => setDeleteId(exam.id)}
                        title="Remover"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {deleteId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="bg-card border-border max-w-md w-full">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                Remover exame
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground dark:text-muted-foreground text-sm">
                O arquivo será apagado do armazenamento e o registro removido. Deseja continuar?
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setDeleteId(null)}
                  disabled={deleting}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1 bg-destructive hover:bg-destructive/90"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remover"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
