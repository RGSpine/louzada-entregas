"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "@/lib/logger";

type Props = {
  children: ReactNode;
  onRetry: () => void;
};

type State = {
  error: Error | null;
};

/**
 * Contém falhas só da grade Schedule-X — FAB, intake, Google e modais
 * fora deste boundary continuam usáveis.
 */
export class AgendaCalendarErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error("Schedule-X crash na grade da agenda", {
      feature: "agenda-calendar",
      error: error.message,
      componentStack: info.componentStack?.slice(0, 500),
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-4 text-center">
          <p className="text-sm font-medium text-foreground">
            Não foi possível carregar a grade da agenda.
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            As outras funções (áudio, Google, nova marcação) continuam disponíveis.
            Tente de novo ou atualize a página.
          </p>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            onClick={() => {
              this.setState({ error: null });
              this.props.onRetry();
            }}
          >
            Tentar de novo
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
