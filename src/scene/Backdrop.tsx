import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, Group, Mesh, ShaderMaterial } from 'three'
import { quadGeo, sphereGeo } from './geometry'
import type { QualityProfile } from './quality'
import { runtime } from './runtime'
import { billboardVertex, glowSpriteFragment, skyFragment, skyVertex, starFragment, starVertex, sunFragment } from './shaders/misc'
import { atmosphereVertex } from './shaders/planet'
import { uiStore } from '../state/uiStore'

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ sky */

export function Sky({ quality, presence }: { quality: QualityProfile; presence: { current: number } }) {
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: BackSide,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uOct: { value: 3 }, uOpacity: { value: 1 } },
      }),
    [],
  )
  useEffect(() => {
    mat.uniforms.uOct!.value = quality.nebula
  }, [mat, quality.nebula])
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(() => {
    mat.uniforms.uTime!.value = runtime.time
    mat.uniforms.uOpacity!.value = 0.85 + 0.15 * presence.current
  })
  return <mesh geometry={sphereGeo(16)} material={mat} renderOrder={-1000} frustumCulled={false} />
}

/* ---------------------------------------------------------------- stars */

interface Layer {
  radius: number
  count: number
  size: number
  speed: number
  jitter: number
}

const LAYERS: Layer[] = [
  { radius: 1100, count: 2600, size: 1.7, speed: 0.0006, jitter: 0.2 },
  { radius: 520, count: 1300, size: 2.3, speed: -0.0011, jitter: 0.25 },
  { radius: 210, count: 380, size: 3.0, speed: 0.002, jitter: 0.35 },
]

function buildStars(layer: Layer, seed: number, scale: number): BufferGeometry {
  const rand = rng(seed)
  const n = Math.max(40, Math.floor(layer.count * scale))
  const pos = new Float32Array(n * 3)
  const size = new Float32Array(n)
  const phase = new Float32Array(n)
  const color = new Float32Array(n * 3)
  const tint = [new Color('#ffffff'), new Color('#bcd2ff'), new Color('#ffe2bd'), new Color('#ffd0c0')]
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1
    const t = rand() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    const r = layer.radius * (1 + (rand() - 0.5) * layer.jitter)
    pos.set([s * Math.cos(t) * r, u * r, s * Math.sin(t) * r], i * 3)
    size[i] = layer.size * (0.45 + Math.pow(rand(), 3) * 1.7)
    phase[i] = rand()
    const c = tint[Math.floor(Math.pow(rand(), 2) * tint.length)]!
    const k = 0.55 + rand() * 0.45
    color.set([c.r * k, c.g * k, c.b * k], i * 3)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aSize', new BufferAttribute(size, 1))
  g.setAttribute('aPhase', new BufferAttribute(phase, 1))
  g.setAttribute('aColor', new BufferAttribute(color, 3))
  return g
}

export function Starfield({ quality }: { quality: QualityProfile }) {
  const group = useRef<Group>(null)
  const layers = useMemo(
    () =>
      LAYERS.map((l, i) => ({
        layer: l,
        geo: buildStars(l, 1337 + i * 97, quality.starScale),
        mat: new ShaderMaterial({
          vertexShader: starVertex,
          fragmentShader: starFragment,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uTwinkle: { value: 1 }, uOpacity: { value: 1 } },
        }),
      })),
    [quality.starScale],
  )
  useEffect(
    () => () =>
      layers.forEach((l) => {
        l.geo.dispose()
        l.mat.dispose()
      }),
    [layers],
  )
  useFrame((state, dt) => {
    const px = state.gl.getPixelRatio()
    layers.forEach((l, i) => {
      const u = l.mat.uniforms
      u.uTime!.value = runtime.time
      u.uPx!.value = px
      u.uTwinkle!.value = runtime.reducedMotion ? 0 : 1
      const child = group.current?.children[i]
      if (child && !runtime.reducedMotion) child.rotation.y += l.layer.speed * dt * 8
    })
  })
  return (
    <group ref={group}>
      {layers.map((l, i) => (
        <points key={i} geometry={l.geo} material={l.mat} frustumCulled={false} renderOrder={-900 + i} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ sun */

function GlowSprite({ size, color, intensity, power, ctl }: { size: number; color: string; intensity: number; power: number; ctl: { current: number } }) {
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: billboardVertex,
        fragmentShader: glowSpriteFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uSize: { value: size },
          uColor: { value: new Color(color) },
          uIntensity: { value: intensity },
          uPower: { value: power },
          uOpacity: { value: 1 },
        },
      }),
    [size, color, intensity, power],
  )
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(() => {
    mat.uniforms.uOpacity!.value = ctl.current
  })
  return <mesh geometry={quadGeo()} material={mat} frustumCulled={false} renderOrder={5} />
}

export function Sun({ quality, presence }: { quality: QualityProfile; presence: { current: number } }) {
  const group = useRef<Group>(null)
  const body = useRef<Mesh>(null)
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: atmosphereVertex,
        fragmentShader: sunFragment,
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
          uHot: { value: new Color('#ffd89a') },
          uCool: { value: new Color('#d4692a') },
          uOpacity: { value: 1 },
        },
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(() => {
    mat.uniforms.uTime!.value = runtime.time
    mat.uniforms.uOpacity!.value = presence.current
    if (group.current) group.current.visible = presence.current > 0.01
  })
  const g = quality.glow
  return (
    <group ref={group}>
      <mesh
        ref={body}
        geometry={sphereGeo(quality.sphereSegments)}
        material={mat}
        scale={4.2}
        onClick={(e) => {
          e.stopPropagation()
          if (runtime.dragMoved) return
          uiStore.set({ settingsOpen: true })
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          runtime.hovering = true
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          runtime.hovering = false
          document.body.style.cursor = ''
        }}
      />
      <GlowSprite size={20} color="#ffb766" intensity={0.85 * g} power={2.4} ctl={presence} />
      <GlowSprite size={64} color="#ff9a52" intensity={0.28 * g} power={3.2} ctl={presence} />
      <GlowSprite size={150} color="#6f86c9" intensity={0.12 * g} power={2.2} ctl={presence} />
      <GlowSprite size={8} color="#fff4de" intensity={1.0 * g} power={1.6} ctl={presence} />
    </group>
  )
}
