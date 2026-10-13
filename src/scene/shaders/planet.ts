import { NOISE } from './noise'

export const planetVertex = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  vObj = normalize(position);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const planetFragment = /* glsl */ `
precision highp float;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;

uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uSeedV;
uniform float uSeed;
uniform float uScale;
uniform float uTurb;
uniform float uCover;
uniform vec4 uMix;
uniform vec3 uLightDir;
uniform vec3 uAtmo;
uniform float uAtmoI;
uniform float uTime;
uniform float uOpacity;
uniform float uDim;
uniform int uOct;
uniform float uBump;
uniform mat3 uNormalMat;

${NOISE}

float rockH(vec3 q){
  float h1 = fbm(q, uOct);
  float rd = 1.0 - abs(2.0 * fbm(q * 1.9 + 7.3, uOct) - 1.0);
  return mix(h1, rd, 0.25 + 0.5 * uTurb);
}

void main(){
  vec3 p = normalize(vObj);
  float sc = mix(1.1, 4.6, uScale);
  vec3 q = p * sc + uSeedV;

  float wsum = max(uMix.x + uMix.y + uMix.z + uMix.w, 0.001);
  vec3 albedo = vec3(0.0);
  float specMask = 0.0;
  vec3 emissive = vec3(0.0);
  float nightEmit = 0.0;

  // ---- rocky: ridged mountains, soft basins
  float h0 = 0.0;
  if (uMix.x > 0.001) {
    float h = rockH(q);
    h0 = h;
    vec3 c = mix(uB, uA, smoothstep(0.28, 0.68, h));
    c = mix(c, uC, smoothstep(0.7, 0.92, h) * 0.45);
    float fine = vnoise(q * 9.0) - 0.5;
    c *= 0.9 + 0.22 * fine;
    albedo += c * uMix.x;
  }

  // ---- gas giant: latitudinal bands warped by turbulence
  if (uMix.y > 0.001) {
    float lat = p.y;
    vec3 wp = vec3(p.x, lat * 1.4, p.z) * sc * 0.55 + uSeedV;
    float warp = fbm(wp + vec3(uTime * 0.012, 0.0, 0.0), uOct);
    float freq = mix(4.0, 17.0, uCover);
    float band = sin((lat + (warp - 0.5) * mix(0.15, 0.7, uTurb)) * freq * 3.14159);
    float fine = fbm(vec3(p.x * sc * 0.9, lat * freq * 0.9 + warp * 2.0, p.z * sc * 0.9) + uSeedV, uOct);
    float gv = 0.5 + 0.28 * band + (fine - 0.5) * (0.4 + 0.5 * uTurb);
    vec3 c = mix(uB, uA, smoothstep(0.2, 0.8, gv));
    c = mix(c, uC, smoothstep(0.72, 1.0, gv) * 0.35);
    // a large storm eye whose position depends on the seed
    vec3 eye = normalize(vec3(cos(uSeed), -0.28 + 0.2 * sin(uSeed * 1.7), sin(uSeed)));
    float e = length((p - eye) * vec3(1.0, 1.9, 1.0));
    float spot = smoothstep(0.34, 0.08, e) * (0.35 + 0.65 * uTurb);
    c = mix(c, mix(uC, uB, 0.35), spot * 0.8);
    albedo += c * uMix.y;
  }

  // ---- oceanic: continents, shallows, ice caps
  if (uMix.z > 0.001) {
    float land = fbm(q * 0.8, uOct);
    land += (fbm(q * 3.3 + 3.1, uOct) - 0.5) * (0.15 + 0.45 * uTurb);
    float thr = mix(0.36, 0.64, uCover);
    float w = smoothstep(thr - 0.012, thr + 0.012, land);
    float depth = smoothstep(thr - 0.22, thr, land);
    vec3 deep = uA * 0.5;
    vec3 shallow = mix(uA, uC, 0.28) * 1.1;
    vec3 water = mix(deep, shallow, depth);
    vec3 earth = mix(uB, uB * 0.5 + uA * 0.12, smoothstep(thr, thr + 0.28, land));
    float ice = smoothstep(0.8, 0.93, abs(p.y) + (fbm(q * 2.0, 3) - 0.5) * 0.14);
    vec3 c = mix(mix(water, earth, w), uC, ice);
    albedo += c * uMix.z;
    specMask += (1.0 - w) * (1.0 - ice) * uMix.z;
  }

  // ---- technological: panelled hull, circuit grid, city lights
  if (uMix.w > 0.001) {
    vec2 sph = vec2(atan(p.z, p.x) / 6.28318 + 0.5, asin(clamp(p.y, -1.0, 1.0)) / 3.14159 + 0.5);
    float cells = mix(12.0, 52.0, uScale);
    vec2 g = sph * vec2(cells * 2.0, cells);
    vec2 id = floor(g);
    vec2 f = fract(g);
    float r = hash21(id + uSeed * 0.013);
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float grid = 1.0 - smoothstep(0.0, 0.07, edge);
    float panel = fbm(q * 3.0, 3);
    vec3 metal = mix(uA * 0.55, uA * 1.15, panel);
    metal = mix(metal, uB, step(0.8 - 0.25 * uTurb, r) * 0.6);
    metal *= 0.85 + 0.3 * r;
    metal = mix(metal, uB * 1.25, grid * 0.55);
    vec2 cc = abs(f - 0.5);
    float win = step(max(cc.x, cc.y), 0.2) * step(1.0 - uCover * 0.55, fract(r * 7.13 + 0.17));
    float flick = 0.75 + 0.25 * sin(uTime * (0.6 + r * 2.0) + r * 40.0);
    emissive += uC * (win * flick * 1.1 + grid * 0.12) * uMix.w;
    nightEmit += uMix.w;
    albedo += metal * uMix.w;
    specMask += 0.28 * uMix.w;
  }

  albedo /= wsum;
  specMask /= wsum;
  emissive /= wsum;

  vec3 N0 = normalize(vNormalW);
  vec3 N = N0;
  if (uBump > 0.5 && uMix.x > 0.001) {
    // relief from finite differences of the height field (object space), then rotated to world space
    float e = 0.03;
    vec3 g = vec3(rockH(q + vec3(e, 0.0, 0.0)) - h0, rockH(q + vec3(0.0, e, 0.0)) - h0, rockH(q + vec3(0.0, 0.0, e)) - h0) / e;
    g -= dot(g, p) * p;
    float k = uMix.x / wsum * (0.06 + uCover * 0.2);
    vec3 nObj = normalize(p - k * g);
    N = normalize(uNormalMat * nObj);
  }
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorld);

  float ndl = dot(N, L);
  float diff = smoothstep(-0.1, 0.7, ndl);
  vec3 ambient = vec3(0.05, 0.062, 0.092);
  vec3 sun = vec3(1.0, 0.94, 0.85) * 1.32;
  vec3 col = albedo * (ambient + sun * diff);

  float term = smoothstep(0.0, 0.22, ndl) * smoothstep(0.55, 0.05, ndl);
  col += albedo * vec3(0.95, 0.42, 0.2) * term * 0.14;

  vec3 H = normalize(L + V);
  float sp = pow(max(dot(N, H), 0.0), 70.0) * specMask * diff;
  col += vec3(1.0, 0.96, 0.9) * sp * 0.55;

  float night = smoothstep(0.12, -0.2, dot(N0, L));
  col += emissive * mix(0.08, 1.0, night);

  float fr = pow(1.0 - max(dot(N0, V), 0.0), 3.0);
  col += uAtmo * fr * uAtmoI * 0.3 * smoothstep(-0.35, 0.5, dot(N0, L));

  col *= uDim;
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export const atmosphereVertex = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  vObj = normalize(position);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

/** Glow seen from outside: back faces of a larger shell, falling off with distance from the limb. */
export const glowFragment = /* glsl */ `
precision highp float;
varying vec3 vNormalW;
varying vec3 vWorld;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uPower;
uniform vec3 uLightDir;
uniform float uOpacity;
void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  float a = clamp(-dot(N, V), 0.0, 1.0);
  float lit = mix(0.18, 1.0, smoothstep(-0.5, 0.6, dot(N, normalize(uLightDir))));
  float g = pow(a, uPower) * uIntensity;
  gl_FragColor = vec4(uColor, clamp(g * lit * uOpacity, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** Cloud / storm / aurora layer wrapped around the surface. */
export const cloudFragment = /* glsl */ `
precision highp float;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uSeed;
uniform vec3 uSeedV;
uniform vec3 uLightDir;
uniform float uOpacity;
uniform int uKind; // 3 aurora, 4 storm, 5 clouds
uniform int uOct;
${NOISE}
void main(){
  vec3 p = normalize(vObj);
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndl = dot(N, L);
  float day = smoothstep(-0.2, 0.55, ndl);
  vec3 col = vec3(0.0);
  float a = 0.0;

  if (uKind == 3) {
    // aurora curtains hugging both poles, shimmering with longitude
    float lat = abs(p.y);
    float band = smoothstep(0.52, 0.72, lat) * (1.0 - smoothstep(0.88, 0.99, lat));
    float ang = atan(p.z, p.x);
    float n = fbm(vec3(ang * 1.6 + uTime * 0.08, lat * 6.0, uTime * 0.12) + uSeedV, uOct);
    float curtain = pow(smoothstep(0.35, 0.85, n), 1.4);
    float shimmer = 0.65 + 0.35 * sin(ang * 9.0 + uTime * 0.7 + n * 6.0);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 1.2);
    a = band * curtain * shimmer * (0.45 + 0.9 * rim) * uIntensity * 1.8;
    col = mix(uColor, vec3(0.6, 1.0, 0.85), 0.35 * curtain);
    a *= mix(1.0, 0.55, day);
  } else {
    float spin = uTime * (uKind == 4 ? 0.035 : 0.012);
    vec3 q = vec3(p.x * cos(spin) - p.z * sin(spin), p.y, p.x * sin(spin) + p.z * cos(spin));
    float lat = p.y;
    float swirl = fbm(q * 2.2 + uSeedV, uOct);
    float n = fbm(q * (uKind == 4 ? 3.6 : 2.6) + swirl * (uKind == 4 ? 2.2 : 1.1) + uSeedV * 1.7, uOct);
    if (uKind == 4) {
      float bands = 0.5 + 0.5 * sin((lat + (swirl - 0.5) * 0.6) * 14.0);
      n = mix(n, bands, 0.35);
      a = smoothstep(0.45, 0.78, n) * uIntensity;
      vec3 dark = uColor * 0.25;
      col = mix(dark, mix(uColor, vec3(1.0), 0.55), smoothstep(0.62, 0.92, n));
    } else {
      a = smoothstep(0.5, 0.82, n) * uIntensity * 0.85;
      col = mix(uColor, vec3(1.0), 0.7);
    }
    col *= mix(0.12, 1.15, day);
    a *= mix(0.55, 1.0, day);
  }
  gl_FragColor = vec4(col, a * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
