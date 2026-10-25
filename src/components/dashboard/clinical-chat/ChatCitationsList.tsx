"use client";

import { ExternalLink, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClinicalChatCitation } from "@/app/actions/clinical-chat";

type ChatCitationsListProps = {
  citations: ClinicalChatCitation[];
};

function sourceLabel(source: ClinicalChatCitation["source"]): string {
  switch (source) {
    case "consensus":
      return "Consensus";
    case "pubmed":
      return "PubMed";
    default:
      return "Perplexity";
  }
}

function sourceBadgeClass(source: ClinicalChatCitation["source"]): string {
  switch (source) {
    case "pubmed":
      return "border-primary/30 bg-primary/10 text-primary dark:border-primary/40 dark:bg-primary/15 dark:text-primary";
    case "consensus":
      return "border-primary/30 bg-primary/10 text-primary dark:border-primary/40 dark:bg-primary/15 dark:text-primary";
    default:
      return "border-clinical/30 bg-clinical/10 text-clinical dark:border-clinical/40 dark:bg-clinical/15 dark:text-clinical";
  }
}

export function ChatCitationsList({ citations }: ChatCitationsListProps) {
  if (citations.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-border/90 bg-muted/80 p-3 dark:border-border/80 bg-background/50">
      <p className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5 text-clinical" aria-hidden />
        Referências ({citations.length})
      </p>
      <ul className="space-y-2">
        {citations.map((c, idx) => (
          <li
            key={`${c.id}-${idx}`}
            className="rounded-lg border border-white bg-white p-3 shadow-sm dark:border-border/60 bg-card/80"
          >
            <div className="flex flex-wrap items-start gap-2">
              <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-clinical/15 px-1.5 font-mono text-xs font-bold text-clinical dark:bg-clinical/15 dark:text-clinical">
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-start gap-1.5 font-medium text-foreground hover:text-clinical dark:text-foreground dark:hover:text-clinical"
                >
                  <span className="line-clamp-2 text-sm leading-snug group-hover:underline">
                    {c.title}
                  </span>
                  <ExternalLink
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60 group-hover:opacity-100"
                    aria-hidden
                  />
                </a>
                {(c.authors || c.year || c.journal || c.studyType) && (
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {[
                      c.authors,
                      c.year ? String(c.year) : null,
                      c.journal,
                      c.studyType,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {c.snippet ? (
                  <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground dark:text-muted-foreground">
                    {c.snippet}
                  </p>
                ) : null}
              </div>
              <Badge
                variant="outline"
                className={cn("shrink-0 text-[10px] font-semibold", sourceBadgeClass(c.source))}
              >
                {sourceLabel(c.source)}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
