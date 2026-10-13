import { NOISE } from './noise'

/** Camera-facing quad with a radial falloff: sun corona, beacons, bursts. */
export const billboardVertex = /* glsl */ `
varying vec2 vUv;
uniform float uSize;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`

export const glowSpriteFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uPower;
uniform float uOpacity;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float g = pow(clamp(1.0 - d, 0.0, 1.0), uPower) * uIntensity * uOpacity;
  gl_FragColor = vec4(uColor, clamp(g, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** Expanding shock ring (completion / formation bursts). */
export const shockFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uProgress;
uniform float uOpacity;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float r = uProgress;
  float w = mix(0.14, 0.03, uProgress);
  float ring = smoothstep(w, 0.0, abs(d - r)) * (1.0 - uProgress) * uOpacity;
  gl_FragColor = vec4(uColor, clamp(ring, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** Progress ring: an arc that fills clockwise from 12 o'clock over a faint track. */
export const ringVertex = /* glsl */ `
varying vec3 vPos;
void main(){
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const ringFragment = /* glsl */ `
precision highp float;
varying vec3 vPos;
uniform vec3 uColor;
uniform vec3 uTrack;
uniform float uProgress;
uniform float uOpacity;
uniform float uTrackAlpha;
uniform float uTime;
uniform float uPulse;
${NOISE}
void main(){
  float ang = atan(vPos.x, vPos.y);               // 0 at +Y, clockwise positive
  float t = fract(ang / 6.2831853 + 1.0);         // 0..1 around the ring
  float fill = step(t, uProgress);
  float head = exp(-abs(t - uProgress) * 38.0) * step(0.001, uProgress) * step(uProgress, 0.999);
  float dust = 0.82 + 0.18 * vnoise(vec3(vPos.xy * 9.0, 1.0));
  vec3 col = mix(uTrack, uColor, fill) * dust;
  col += uColor * head * 1.2;
  float a = mix(uTrackAlpha, 0.95, fill) + head * 0.4;
  a *= uOpacity;
  a *= 1.0 + uPulse * 0.25 * sin(uTime * 2.0);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** Planet/orbit rails: thin circles that fade with the viewing angle. */
export const orbitFragment = /* glsl */ `
precision highp float;
varying vec3 vPos;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uDash;
void main(){
  float ang = atan(vPos.z, vPos.x);
  float dash = mix(1.0, 0.55 + 0.45 * sin(ang * 90.0), uDash);
  float a = uOpacity * dash;
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export const orbitVertex = /* glsl */ `
varying vec3 vPos;
void main(){
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const sunFragment = /* glsl */ `
precision highp float;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
uniform float uTime;
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uOpacity;
${NOISE}
void main(){
  vec3 p = normalize(vObj);
  float n = fbm(p * 3.2 + vec3(uTime * 0.03, 0.0, uTime * 0.02), 4);
  float n2 = fbm(p * 8.0 - vec3(0.0, uTime * 0.05, 0.0), 3);
  vec3 V = normalize(cameraPosition - vWorld);
  float mu = max(dot(normalize(vNormalW), V), 0.0);
  float limb = pow(mu, 0.55);
  vec3 col = mix(uCool, uHot, smoothstep(0.25, 0.85, n * 0.7 + n2 * 0.5));
  col *= 0.45 + 0.8 * limb;
  gl_FragColor = vec4(col * 1.05, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export const skyVertex = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`

export const skyFragment = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform int uOct;
uniform float uOpacity;
${NOISE}
void main(){
  vec3 d = normalize(vDir);
  vec3 base = mix(vec3(0.010, 0.014, 0.026), vec3(0.020, 0.024, 0.046), smoothstep(-0.6, 0.8, d.y));
  vec3 col = base;
  if (uOct > 0) {
    vec3 axis = normalize(vec3(0.35, 0.82, -0.45));
    float bandD = dot(d, axis);
    float galaxy = exp(-bandD * bandD * 10.0);
    float w = fbm(d * 2.2 + 3.0, uOct);
    float cloud = fbm(d * 3.4 + w * 1.4 + vec3(uTime * 0.002), uOct);
    float m = smoothstep(0.38, 0.85, cloud);
    vec3 warm = vec3(0.34, 0.20, 0.17);
    vec3 cold = vec3(0.12, 0.17, 0.34);
    vec3 neb = mix(cold, warm, smoothstep(0.35, 0.8, w));
    col += neb * m * (0.04 + 0.2 * galaxy);
    col += vec3(0.5, 0.52, 0.62) * galaxy * 0.018 * fbm(d * 26.0, 3);
  }
  gl_FragColor = vec4(col * uOpacity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export const starVertex = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
varying vec3 vColor;
varying float vTw;
uniform float uTime;
uniform float uPx;
uniform float uTwinkle;
void main(){
  vColor = aColor;
  vTw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (0.6 + aPhase * 1.6) + aPhase * 60.0)) * 0.55;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPx;
}
`

export const starFragment = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vTw;
uniform float uOpacity;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2) * vTw * uOpacity;
  gl_FragColor = vec4(vColor, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export const linkVertex = /* glsl */ `
attribute float aT;
attribute float aPhase;
varying float vT;
varying float vPulse;
uniform float uTime;
uniform float uScale;
uniform float uSize;
void main(){
  vT = aT;
  // two energy pulses travelling from one task to the other
  float w = fract(aT * 1.0 - uTime * 0.22 + aPhase);
  float w2 = fract(aT * 1.0 + 0.5 - uTime * 0.22 + aPhase);
  vPulse = max(exp(-pow((w - 0.5) * 7.0, 2.0)), exp(-pow((w2 - 0.5) * 7.0, 2.0)));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float edge = smoothstep(0.0, 0.1, aT) * smoothstep(1.0, 0.9, aT);
  gl_PointSize = max(1.5, uSize * (0.5 + 0.95 * vPulse) * edge * uScale / max(0.1, -mv.z));
}
`

export const linkFragment = /* glsl */ `
precision highp float;
varying float vT;
varying float vPulse;
uniform vec3 uColor;
uniform float uOpacity;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float soft = pow(clamp(1.0 - d, 0.0, 1.0), 1.6);
  float edge = smoothstep(0.0, 0.1, vT) * smoothstep(1.0, 0.9, vT);
  float a = soft * (0.32 + 0.68 * vPulse) * edge * uOpacity;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), vPulse * 0.3), clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
