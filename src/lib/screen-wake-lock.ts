/**
 * Mantém o ecrã ligado durante gravação/processamento longo (Screen Wake Lock API).
 * Safari iOS 16.4+ / Chrome Android — best-effort; ignora silenciosamente se indisponível.
 */

export type ScreenWakeLockHandle = {
  release: () => Promise<void>;
};

export async function requestScreenWakeLock(): Promise<ScreenWakeLockHandle | null> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    return null;
  }
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    const release = async () => {
      try {
        await sentinel.release();
      } catch {
        /* já libertado */
      }
    };
    return { release };
  } catch {
    return null;
  }
}
