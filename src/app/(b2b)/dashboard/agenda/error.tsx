"use client";

import { useEffect } from "react";
import Link from "next/link";
import { logger } from "@/lib/logger";

/**
 * Rede de segurança da rota /dashboard/agenda.
 * Se algo escapar do boundary da grade, a user não fica na tela preta do Next.
 */
export default function AgendaRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("Erro na rota da agenda", {
      feature: "agenda-calendar",
      error: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold text-foreground">Falha ao abrir a agenda</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Ocorreu um erro inesperado ao carregar esta página. Pode tentar de novo sem sair do
        dashboard.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Tentar de novo
        </button>
        <Link
          href="/dashboard"
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground"
        >
          Voltar ao painel
        </Link>
      </div>
    </div>
  );
}
