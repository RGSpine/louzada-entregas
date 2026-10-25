"use client";

import { ExternalLink, BookOpen, RefreshCw, X } from "lucide-react";
import { ClinicalCalmModal } from "@/components/ui/ClinicalCalmModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClinicalRecommendationItem } from "@/lib/clinical-chat/recommendations-cache";

export type ClinicalRecommendationsPayload = {
  items: ClinicalRecommendationItem[];
  rationale: string | null;
  generatedAt: string;
  fromCache: boolean;
  profileTags: string[];
  sessionsAnalyzed: number;
};

type ClinicalRecommendationsPanelProps = {
  open: boolean;
  onClose: () => void;
  loading?: boolean;
  refreshing?: boolean;
  data: ClinicalRecommendationsPayload | null;
  error?: string | null;
  onRefresh?: () => void;
};

function sourceLabel(source: ClinicalRecommendationItem["source"]): string {
  switch (source) {
    case "pubmed":
      return "PubMed";
    case "consensus":
      return "Consensus";
    default:
      return "Perplexity";
  }
}

function formatGeneratedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ClinicalRecommendationsPanel({
  open,
  onClose,
  loading = false,
  refreshing = false,
  data,
  error = null,
  onRefresh,
}: ClinicalRecommendationsPanelProps) {
  const headingId = "clinical-recommendations-title";

  return (
    <ClinicalCalmModal
      open={open}
      onClose={onClose}
      align="bottom"
      zIndexClass="z-[60]"
      labelledBy={headingId}
      className="flex max-h-[min(92dvh,820px)] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl rounded-b-none p-0 sm:rounded-xl sm:p-0"
    >
      <div className="flex max-h-[min(92dvh,820px)] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              <h2 id={headingId} className="text-lg font-bold text-foreground">
                Indicações para você
              </h2>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Artigos sugeridos com base no seu perfil clínico e nas últimas conversas na Ester.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onRefresh ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={onRefresh}
                disabled={loading || refreshing}
                aria-label="Atualizar indicações"
              >
                <RefreshCw
                  className={cn("h-4 w-4", (loading || refreshing) && "animate-spin")}
                  aria-hidden
                />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={onClose}
              aria-label="Fechar indicações"
            >
              <X className="h-5 w-5" aria-hidden />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <RefreshCw className="h-8 w-8 animate-spin text-clinical" aria-hidden />
              <p className="text-sm text-muted-foreground">Buscando artigos relevantes…</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-border bg-muted/50 px-4 py-8 text-center">
              <p className="text-sm leading-relaxed text-muted-foreground">{error}</p>
            </div>
          ) : data ? (
            <>
              {data.profileTags.length > 0 ? (
                <div className="mb-4 flex flex-wrap gap-2">
                  {data.profileTags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs font-medium">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}

              {data.rationale ? (
                <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{data.rationale}</p>
              ) : null}

              <ul className="space-y-3">
                {data.items.map((item, idx) => (
                  <li
                    key={`${item.id}-${idx}`}
                    className="rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-clinical/30"
                  >
                    <div className="flex flex-wrap items-start gap-2">
                      <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg bg-clinical/10 px-2 font-mono text-xs font-bold text-clinical">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group inline-flex items-start gap-1.5 font-semibold text-foreground hover:text-clinical"
                        >
                          <span className="line-clamp-3 text-[0.9375rem] leading-snug group-hover:underline">
                            {item.title}
                          </span>
                          <ExternalLink
                            className="mt-0.5 h-4 w-4 shrink-0 opacity-60 group-hover:opacity-100"
                            aria-hidden
                          />
                        </a>
                        {(item.authors || item.year || item.journal || item.studyType) && (
                          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                            {[item.authors, item.year ? String(item.year) : null, item.journal, item.studyType]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        {item.snippet ? (
                          <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-muted-foreground">
                            {item.snippet}
                          </p>
                        ) : null}
                        {item.matchedTopic ? (
                          <p className="mt-2 text-xs font-medium text-clinical">
                            Relacionado a: {item.matchedTopic}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px] font-semibold">
                        {sourceLabel(item.source)}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>

              <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" aria-hidden />
                {data.sessionsAnalyzed > 0 && data.profileTags.length === 0
                  ? `Baseado em ${data.sessionsAnalyzed} conversa(s) recente(s)`
                  : data.profileTags.length > 0
                    ? "Baseado no seu perfil clínico"
                    : "Sem sinais suficientes"}
                {data.generatedAt ? ` · ${formatGeneratedAt(data.generatedAt)}` : null}
                {data.fromCache ? " · em cache" : null}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </ClinicalCalmModal>
  );
}
