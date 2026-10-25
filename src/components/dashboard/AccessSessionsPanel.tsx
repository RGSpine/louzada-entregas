"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MonitorSmartphone, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getMyAccessSessions,
  revokeMyAccessSession,
  type AccessSessionsSnapshot,
} from "@/app/actions/access-sessions";

function formatSeenAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Contador em tempo real de dispositivos com heartbeat recente (~10 min).
 */
export function AccessSessionsPanel() {
  const [data, setData] = useState<AccessSessionsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getMyAccessSessions();
    if (!res.success) {
      toast.error(res.error);
      setData(null);
      return;
    }
    setData(res.data);
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
    const timer = setInterval(() => {
      void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function handleRevoke(sessionId: string, isCurrent: boolean) {
    if (isCurrent) {
      toast.error("Não é possível encerrar o dispositivo atual por aqui. Use Sair.");
      return;
    }
    setBusyId(sessionId);
    try {
      const res = await revokeMyAccessSession(sessionId);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Dispositivo desconectado.");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const maxLabel = data
    ? Number.isFinite(data.maxSessions)
      ? String(data.maxSessions)
      : "∞"
    : "—";

  return (
    <Card className="bg-card border-border mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-foreground flex items-center gap-2 text-base">
              <MonitorSmartphone className="h-5 w-5 text-primary" aria-hidden />
              Dispositivos ativos
            </CardTitle>
            <CardDescription>
              {data && Number.isFinite(data.maxSessions) && data.maxSessions === 1
                ? "Plano individual: um aparelho por vez. O último login desconecta o anterior (vale o IP mais recente)."
                : `Planos de equipe: só contam aparelhos com atividade nos últimos ${data?.concurrentWindowMinutes ?? 10} min. Acima do teto, um novo acesso é bloqueado.`}
            </CardDescription>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0"
            disabled={loading}
            onClick={() => void load()}
            aria-label="Atualizar dispositivos ativos"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verificando…
          </div>
        ) : (
          <>
            <Badge variant="secondary">
              {data?.activeSessions ?? 0} de {maxLabel} acessos simultâneos
            </Badge>

            {!data?.sessions.length ? (
              <p className="text-sm text-muted-foreground">
                Nenhum outro dispositivo com atividade recente.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data.sessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {s.deviceLabel || s.platform}
                        {s.isCurrent ? (
                          <span className="ml-2 text-xs font-normal text-primary">
                            (este dispositivo)
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Última atividade: {formatSeenAt(s.lastSeenAt)}
                        {s.ipAddress ? ` · IP ${s.ipAddress}` : ""}
                      </p>
                    </div>
                    {!s.isCurrent ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        disabled={busyId === s.id}
                        onClick={() => void handleRevoke(s.id, s.isCurrent)}
                        aria-label="Encerrar acesso neste dispositivo"
                      >
                        {busyId === s.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
