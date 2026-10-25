"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  jarvisOrbFragmentShader,
  jarvisOrbVertexShader,
} from "@/components/creative-3d/shaders/jarvis-orb.shaders";
import type { JarvisOrbMeshProps } from "@/components/creative-3d/types";
import {
  JARVIS_PALETTE_DEFAULT,
  jarvisStateUniforms,
} from "@/lib/creative-3d/palette";

type Props = JarvisOrbMeshProps & {
  autoRotate?: boolean;
};

export function JarvisOrbMesh({
  state,
  intensity,
  palette,
  autoRotate = true,
}: Props) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const mergedPalette = useMemo(
    () => ({ ...JARVIS_PALETTE_DEFAULT, ...palette }),
    [palette],
  );

  const stateUniforms = useMemo(() => jarvisStateUniforms(state), [state]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: stateUniforms.intensity },
      uActive: { value: stateUniforms.active },
      uPulse: { value: 0 },
      uColorCore: { value: new THREE.Color(mergedPalette.core) },
      uColorGlow: { value: new THREE.Color(mergedPalette.glow) },
    }),
    [mergedPalette.core, mergedPalette.glow, stateUniforms.active, stateUniforms.intensity],
  );

  useFrame((_, delta) => {
    const mat = materialRef.current;
    const mesh = meshRef.current;
    if (!mat) return;

    mat.uniforms.uTime.value += delta;
    mat.uniforms.uIntensity.value = intensity ?? stateUniforms.intensity;
    mat.uniforms.uActive.value = stateUniforms.active;
    mat.uniforms.uPulse.value =
      0.5 + 0.5 * Math.sin(mat.uniforms.uTime.value * (state === "processing" ? 4.5 : 2.2));
    (mat.uniforms.uColorCore.value as THREE.Color).set(mergedPalette.core);
    (mat.uniforms.uColorGlow.value as THREE.Color).set(mergedPalette.glow);

    if (autoRotate && mesh) {
      mesh.rotation.y += delta * (state === "processing" ? 0.9 : 0.35);
      mesh.rotation.x = Math.sin(mat.uniforms.uTime.value * 0.4) * 0.08;
    }
  });

  return (
    <mesh ref={meshRef} scale={1.15}>
      <icosahedronGeometry args={[1, 4]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={jarvisOrbVertexShader}
        fragmentShader={jarvisOrbFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}
