export type {
  Creative3dCapability,
  Creative3dTier,
  JarvisOrbButtonProps,
  JarvisOrbMeshProps,
  JarvisPalette,
  JarvisVisualState,
} from "@/components/creative-3d/types";

export { JarvisOrbMesh } from "@/components/creative-3d/meshes/JarvisOrbMesh";
export { JarvisCanvasShell } from "@/components/creative-3d/canvas/JarvisCanvasShell";
export { JarvisCanvasLazy } from "@/components/creative-3d/canvas/JarvisCanvasLazy";
export { JarvisOrbFallback } from "@/components/creative-3d/fallback/JarvisOrbFallback";
export { JarvisOrbButton } from "@/components/creative-3d/interactive/JarvisOrbButton";

export {
  jarvisOrbVertexShader,
  jarvisOrbFragmentShader,
} from "@/components/creative-3d/shaders/jarvis-orb.shaders";

export {
  useCreative3dCapability,
  setCreative3dForceFallback,
} from "@/lib/creative-3d/useCreative3dCapability";

export {
  JARVIS_PALETTE_DEFAULT,
  jarvisStateUniforms,
} from "@/lib/creative-3d/palette";
