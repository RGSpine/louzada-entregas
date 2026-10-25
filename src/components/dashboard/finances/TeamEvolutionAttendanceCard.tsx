"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatTeamAttendanceDate,
  formatTeamAttendanceOutcome,
  type TeamEvolutionAttendanceRow,
} from "@/lib/finance/team-evolution-attendance";

export function TeamEvolutionAttendanceCard({
  rows,
  loading,
}: {
  rows: TeamEvolutionAttendanceRow[];
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Atendimentos da equipe</CardTitle>
        <CardDescription>
          Só administradores — data do atendimento, se baixou sessão / fechou
          serviço e qual profissional (Intra User) atendeu.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando atendimentos…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma evolução nativa neste período.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.evolutionId}
                className="rounded-lg border border-border px-3 py-2.5 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tabular-nums">
                    {formatTeamAttendanceDate(row.attendanceDateIso)}
                  </span>
                  <Link
                    href={`/dashboard/patients/${row.patientId}?tab=services`}
                    className="font-medium text-clinical underline-offset-2 hover:underline"
                  >
                    {row.patientName}
                  </Link>
                  <Badge
                    variant="outline"
                    className="font-normal"
                    style={
                      row.professionalColor
                        ? { borderColor: row.professionalColor, color: row.professionalColor }
                        : undefined
                    }
                  >
                    {row.professionalName}
                    {row.professionalRole === "ADMIN"
                      ? " · admin"
                      : row.professionalRole === "MEMBER"
                        ? " · membro"
                        : ""}
                  </Badge>
                  {row.sessionConsumed ? (
                    <Badge variant="secondary">Sessão baixada</Badge>
                  ) : (
                    <Badge variant="outline">Sem baixa</Badge>
                  )}
                  {row.saleClosed ? (
                    <Badge variant="secondary">
                      {row.salePaid ? "Serviço pago" : "Serviço fechado"}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatTeamAttendanceOutcome(row)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
