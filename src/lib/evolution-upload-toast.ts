import { toast } from "sonner";

/** IDs estáveis — um único toast por fluxo; evita empilhar "Enviando áudio…" a 0%. */
export const EVOLUTION_UPLOAD_TOAST_MAIN = "evolution-audio-upload-main";
export const EVOLUTION_UPLOAD_TOAST_ADDITIONAL = "evolution-audio-upload-additional";

export function evolutionUploadToastStart(toastId: string, label: string): void {
  toast.loading(label, { id: toastId, description: "0%" });
}

export function evolutionUploadToastProgress(
  toastId: string,
  label: string,
  pct: number,
): void {
  toast.loading(label, { id: toastId, description: `${pct}%` });
}

export function evolutionUploadToastDismiss(toastId: string): void {
  toast.dismiss(toastId);
}

export function dismissAllEvolutionUploadToasts(): void {
  toast.dismiss(EVOLUTION_UPLOAD_TOAST_MAIN);
  toast.dismiss(EVOLUTION_UPLOAD_TOAST_ADDITIONAL);
}
