"use client";

import { useSyncExternalStore } from "react";
import type { Creative3dCapability } from "@/components/creative-3d/types";

const STORAGE_KEY = "aievolui-creative3d-force-fallback";

function detectWebgl(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    return Boolean(gl);
  } catch {
    return false;
  }
}

function detectReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function detectLowPower(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  if (nav.connection?.saveData) return true;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 4) return true;
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency < 4) {
    return true;
  }
  return false;
}

function readForcedFallback(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function computeCapability(): Creative3dCapability {
  const reducedMotion = detectReducedMotion();
  const prefersLowPower = detectLowPower();
  const forcedFallback = readForcedFallback();

  if (forcedFallback) {
    return { tier: "fallback", reason: "forced", reducedMotion, prefersLowPower };
  }
  if (reducedMotion) {
    return { tier: "fallback", reason: "reduced-motion", reducedMotion, prefersLowPower };
  }
  if (!detectWebgl()) {
    return { tier: "fallback", reason: "no-webgl", reducedMotion, prefersLowPower };
  }
  if (prefersLowPower) {
    return { tier: "fallback", reason: "low-power", reducedMotion, prefersLowPower };
  }

  return { tier: "webgl", reducedMotion, prefersLowPower };
}

function subscribeCapability(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => undefined;

  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onMq = () => onStoreChange();
  mq.addEventListener("change", onMq);
  window.addEventListener("storage", onStoreChange);

  return () => {
    mq.removeEventListener("change", onMq);
    window.removeEventListener("storage", onStoreChange);
  };
}

const SERVER_CAPABILITY: Creative3dCapability = {
  tier: "fallback",
  reason: "ssr",
  reducedMotion: false,
  prefersLowPower: false,
};

/** Gate de performance — WebGL só quando seguro; senão fallback 2D (Motion/CSS). */
export function useCreative3dCapability(): Creative3dCapability {
  return useSyncExternalStore(
    subscribeCapability,
    computeCapability,
    () => SERVER_CAPABILITY,
  );
}

/** Utilitário para QA: forçar fallback sem WebGL. */
export function setCreative3dForceFallback(force: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (force) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* ignore */
  }
}
