"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  dismissEvolutionJobId,
  getDismissedEvolutionJobIds,
} from "@/lib/evolution-job-dismissed";
import { savePendingEvolutionJob } from "@/lib/evolution-pending-job";

export type RecoverableEvolutionJob = {
  jobId: string;
  status: "QUEUED" | "PROCESSING" | "SUCCEEDED";
  createdAt: string;
  finishedAt: string | null;
  patientHint: string | null;
  audioDurationSec: number | null;
};

function formatJobTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function jobMessage(job: RecoverableEvolutionJob): { title: string; body: string } {
  const when = formatJobTime(job.createdAt);
  const patient = job.patientHint ? ` (${job.patientHint})` : "";

  if (job.status === "SUCCEEDED") {
    return {
      title: "Evolução por áudio pronta para recuperar",
      body: `Processada em ${when}${patient}. Toque abaixo para abrir o texto na Nova Evolução — não precisa gravar de novo.`,
    };
  }
  if (job.status === "PROCESSING") {
    return {
      title: "Áudio ainda em processamento",
      body: `Enviado às ${when}. A IA ainda está a trabalhar — pode continuar a aguardar ou voltar mais tarde.`,
    };
  }
  return {
    title: "Áudio na fila de processamento",
    body: `Enviado às ${when}. Se demorar, toque em recuperar — o sistema vai verificar o estado automaticamente.`,
  };
}

/**
 * Banner no dashboard — só aparece quando há jobs recuperáveis não dispensados.
 */
export function EvolutionJobRecoveryBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [jobs, setJobs] = useState<RecoverableEvolutionJob[]>([]);
  const [loaded, setLoaded] = useState(false);

  const recoveryInProgressOnPage =
    pathname?.includes("/dashboard/new-evolution") &&
    Boolean(searchParams.get("recoverJobId"));

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/evolution/jobs/active", { cache: "no-store" });
      if (!res.ok) {
        setJobs([]);
        return;
      }
      const data = (await res.json()) as { jobs?: RecoverableEvolutionJob[] };
      const dismissed = getDismissedEvolutionJobIds();
      const visible = (data.jobs ?? []).filter((j) => !dismissed.has(j.jobId));
      setJobs(visible);
    } catch {
      setJobs([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const primary = jobs[0];
  const copy = useMemo(() => (primary ? jobMessage(primary) : null), [primary]);

  if (!loaded || !primary || !copy || recoveryInProgressOnPage) {
    return null;
  }

  const openRecovery = () => {
    savePendingEvolutionJob({
      jobId: primary.jobId,
      createdAt: primary.createdAt,
      patientId: null,
      source: "main",
    });
    router.push(`/dashboard/new-evolution?recoverJobId=${encodeURIComponent(primary.jobId)}`);
  };

  const dismiss = () => {
    dismissEvolutionJobId(primary.jobId);
    setJobs((prev) => prev.filter((j) => j.jobId !== primary.jobId));
  };

  return (
    <div className="container mx-auto max-w-7xl px-4 pt-4">
      <Card
        className="border-warning/40 bg-warning/10 dark:border-warning/50 dark:bg-warning/15"
        role="alert"
      >
        <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <AlertCircle
              className="mt-0.5 h-5 w-5 shrink-0 text-warning"
              aria-hidden
            />
            <div className="space-y-1">
              <p className="font-medium text-warning">{copy.title}</p>
              <p className="text-sm text-warning/85 ">{copy.body}</p>
              {jobs.length > 1 && (
                <p className="text-xs text-warning/70 dark:text-warning/70">
                  + {jobs.length - 1} outro(s) áudio(s) recente(s) na fila de recuperação.
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
            <Button
              type="button"
              className="gap-2 bg-warning hover:bg-warning/90"
              onClick={openRecovery}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              {primary.status === "SUCCEEDED" ? "Abrir evolução" : "Recuperar evolução"}
            </Button>
            {primary.status === "SUCCEEDED" && (
              <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={dismiss}>
                <X className="h-4 w-4" aria-hidden />
                Dispensar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
