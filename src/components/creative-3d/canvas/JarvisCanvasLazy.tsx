"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/** Canvas WebGL — apenas no cliente (evita SSR com Three.js). */
export const JarvisCanvasLazy = dynamic(
  () =>
    import("@/components/creative-3d/canvas/JarvisCanvasShell").then(
      (mod) => mod.JarvisCanvasShell,
    ),
  {
    ssr: false,
    loading: () => null,
  },
);

export type JarvisCanvasLazyProps = ComponentProps<typeof JarvisCanvasLazy>;
