const STORAGE_KEY = "louzada_device_id";

function randomDeviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `dev_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/** ID estável por navegador/app instalado — usado no controle de acessos simultâneos. */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)?.trim();
    if (stored) return stored;
    const next = randomDeviceId();
    window.localStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    return randomDeviceId();
  }
}
