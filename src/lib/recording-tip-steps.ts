import { formatAudioLimitPhrase } from "@/lib/plan-limits";

/** Imagens e legendas do passo a passo de gravação (cartões do dashboard e bloco mobile na Nova Evolução). */

const IMAGES = [
  {
    light: encodeURI("/images/landing/screenshots/light/31- orient áudio 1 light.png"),
    dark: encodeURI("/images/landing/screenshots/dark/31- orient áudio 1 dark.png"),
  },
  {
    light: encodeURI("/images/landing/screenshots/light/32- orient áudio 2 light.png"),
    dark: encodeURI("/images/landing/screenshots/dark/32- orient áudio 2 dark.png"),
  },
  {
    light: encodeURI("/images/landing/screenshots/light/33- orient áudio 3 light.png"),
    dark: encodeURI("/images/landing/screenshots/dark/33- orient áudio 3 dark.png"),
  },
] as const;

/**
 * @param maxAudioMinutes Limite do plano em minutos por gravação; se não for finito (ex.: admin), legendas sem número fixo.
 */
export function buildRecordingTipSteps(maxAudioMinutes: number) {
  const trecho =
    Number.isFinite(maxAudioMinutes) ? formatAudioLimitPhrase(maxAudioMinutes) : null;

  return [
    {
      ...IMAGES[0],
      caption: "Inicie a gravação",
    },
    {
      ...IMAGES[1],
      caption:
        trecho != null
          ? `Grave até ${trecho} e finalize`
          : "Grave o trecho e finalize quando quiser",
    },
    {
      ...IMAGES[2],
      caption:
        trecho != null
          ? `Se quiser acrescentar mais conteúdos com áudio basta clicar nesse botão e gravar até ${trecho}, e repetir isso quantas vezes quiser`
          : "Se quiser acrescentar mais conteúdos com áudio basta clicar nesse botão e gravar novo trecho, repetindo quantas vezes precisar.",
    },
  ] as const;
}

/** Texto do destaque do limite por plano (FREE/STARTER/PRO). */
export function recordingAudioLimitBulletText(maxAudioMinutes: number) {
  if (!Number.isFinite(maxAudioMinutes)) {
    return "Grave seus áudios em trechos; abaixo está o passo a passo para se precisar gravar um conteúdo que demanda mais tempo";
  }
  const trecho = formatAudioLimitPhrase(maxAudioMinutes);
  return `Grave seus áudios em trechos de ${trecho}; abaixo está o passo a passo para se precisar gravar um conteúdo que demanda mais tempo`;
}
