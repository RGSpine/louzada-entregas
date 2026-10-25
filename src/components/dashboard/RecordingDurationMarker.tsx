"use client";

/**
 * Marcador visível do tempo de gravação (decorrer / limite do plano).
 * Usado em todas as superfícies de MediaRecorder do dashboard.
 */
export function RecordingDurationMarker({
  elapsedSeconds,
  maxSeconds,
  className = "",
}: {
  elapsedSeconds: number;
  maxSeconds: number;
  className?: string;
}) {
  const mm = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
  const ss = String(elapsedSeconds % 60).padStart(2, "0");
  const maxLabel =
    maxSeconds >= 3600
      ? "∞"
      : `${String(Math.floor(maxSeconds / 60)).padStart(2, "0")}:00`;

  return (
    <output
      aria-live="polite"
      aria-label={`Tempo de gravação: ${mm} minutos e ${ss} segundos, limite ${maxLabel}`}
      className={`inline-flex items-center justify-center rounded-lg border border-border bg-muted px-3 py-2 text-base font-semibold tabular-nums text-foreground shadow-sm dark:border-border dark:bg-muted dark:text-foreground ${className}`}
    >
      <span>{`${mm}:${ss}`}</span>
      <span className="mx-2 text-muted-foreground dark:text-muted-foreground" aria-hidden>
        /
      </span>
      <span className="text-muted-foreground dark:text-muted-foreground">{maxLabel}</span>
    </output>
  );
}
