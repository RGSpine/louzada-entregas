"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import { JarvisOrbMesh } from "@/components/creative-3d/meshes/JarvisOrbMesh";
import type { JarvisOrbMeshProps } from "@/components/creative-3d/types";

type Props = JarvisOrbMeshProps & {
  className?: string;
  autoRotate?: boolean;
};

function JarvisSceneContent({
  state,
  intensity,
  palette,
  autoRotate,
}: JarvisOrbMeshProps & { autoRotate?: boolean }) {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[2, 3, 4]} intensity={0.85} color="#93c5fd" />
      <directionalLight position={[-3, -1, -2]} intensity={0.35} color="#5eead4" />
      <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.35}>
        <JarvisOrbMesh
          state={state}
          intensity={intensity}
          palette={palette}
          autoRotate={autoRotate}
        />
      </Float>
    </>
  );
}

/**
 * Canvas R3F isolado — importar com `dynamic(..., { ssr: false })`.
 * DPR limitado e alpha para compor sobre botões/UI.
 */
export function JarvisCanvasShell({
  state,
  intensity,
  palette,
  autoRotate = true,
  className,
}: Props) {
  return (
    <div className={className} aria-hidden>
      <Canvas
        dpr={[1, 1.75]}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
          stencil: false,
        }}
        camera={{ position: [0, 0, 3.2], fov: 42, near: 0.1, far: 20 }}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
      >
        <Suspense fallback={null}>
          <JarvisSceneContent
            state={state}
            intensity={intensity}
            palette={palette}
            autoRotate={autoRotate}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
