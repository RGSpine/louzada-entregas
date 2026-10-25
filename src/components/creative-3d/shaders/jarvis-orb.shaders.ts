/**
 * Shaders GLSL — orbe Jarvis com distorção de malha + fresnel.
 * Mantidos como strings para evitar loader webpack extra no Next.js.
 */

export const jarvisOrbVertexShader = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uActive;

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vNormal = normalize(normalMatrix * normal);

  vec3 pos = position;
  float t = uTime;

  float wave =
    sin(pos.x * 4.2 + t * 1.35) *
    cos(pos.y * 3.8 + t * 0.95) * 0.07;

  wave += sin(pos.z * 5.5 + t * 0.75) * 0.045;
  wave += cos((pos.x + pos.y) * 2.5 + t * 1.1) * 0.03;

  float amp = uIntensity * (0.55 + uActive * 1.05);
  pos += normal * wave * amp;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  vViewPosition = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const jarvisOrbFragmentShader = /* glsl */ `
uniform vec3 uColorCore;
uniform vec3 uColorGlow;
uniform float uActive;
uniform float uPulse;

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vec3 viewDir = normalize(vViewPosition);
  float ndv = max(dot(viewDir, vNormal), 0.0);
  float fresnel = pow(1.0 - ndv, 2.8);

  vec3 color = mix(uColorCore, uColorGlow, fresnel * 0.85);
  float rim = smoothstep(0.2, 0.95, fresnel);
  color += uColorGlow * rim * 0.35;

  float brightness = 0.72 + uActive * 0.28 + uPulse * 0.12;
  float alpha = 0.88 + fresnel * 0.12;

  gl_FragColor = vec4(color * brightness, alpha);
}
`;
