/** Helpers para MediaRecorder — Safari/iOS PWA precisa de timeslice + requestData. */

export const MEDIA_RECORDER_TIMESLICE_MS = 1000;

const STOP_TIMEOUT_MS = 4000;

export function isAppleMobileSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
  return isIOS && isSafari;
}

/** iOS Safari expõe pause() mas quebra stop/onstop — ocultar pausa no UI. */
export function isMediaRecorderPauseSupported(recorder?: MediaRecorder | null): boolean {
  if (!recorder || typeof recorder.pause !== "function") return false;
  if (isAppleMobileSafari()) return false;
  return true;
}

export function startMediaRecorder(recorder: MediaRecorder): void {
  recorder.start(MEDIA_RECORDER_TIMESLICE_MS);
}

export function releaseMediaStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  });
}

/** Aguarda evento stop ou timeout; libera tracks se o browser não disparar onstop. */
export function stopMediaRecorderSafely(recorder: MediaRecorder): Promise<boolean> {
  return new Promise((resolve) => {
    if (recorder.state === "inactive") {
      resolve(true);
      return;
    }

    let settled = false;
    const finish = (stopped: boolean) => {
      if (settled) return;
      settled = true;
      recorder.removeEventListener("stop", onStop);
      window.clearTimeout(timer);
      if (!stopped) {
        releaseMediaStream(recorder.stream);
      }
      resolve(stopped);
    };

    const onStop = () => finish(true);
    recorder.addEventListener("stop", onStop, { once: true });

    const timer = window.setTimeout(() => finish(false), STOP_TIMEOUT_MS);

    try {
      if (typeof recorder.requestData === "function") {
        recorder.requestData();
      }
    } catch {
      /* ignore */
    }

    try {
      recorder.stop();
    } catch {
      finish(false);
    }
  });
}
