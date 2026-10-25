"use client";

import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { getSharedPatientCareTimeline } from "@/app/actions/health-journal-professional";
import type { CareTimelineEvent } from "@/lib/b2c/care-timeline-display";

export function PatientHealthJournalPanel({
  patientId,
}: {
  patientId: string;
}) {
  const [events, setEvents] = useState<CareTimelineEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSharedPatientCareTimeline(patientId).then((result) => {
      if (cancelled) return;
      setEvents(result.success ? result.events : []);
    });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (!events || events.length === 0) return null;

  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <GitBranch className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="text-base font-semibold text-foreground">
          Linha do cuidado compartilhada
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Relatos e consultas gravadas que este paciente escolheu mostrar, em ordem.
      </p>
      <ol className="relative mt-4 space-y-0 border-l border-border pl-4">
        {events.map((event) => (
          <li key={event.id} className="relative pb-4">
            <span
              className="absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary"
              aria-hidden
            />
            <p className="text-xs text-muted-foreground">
              {new Date(event.at).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
              {" · "}
              {event.kind === "journal" ? "Relato" : "Consulta"}
            </p>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              {event.title}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {event.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
