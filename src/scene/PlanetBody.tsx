import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BackSide, Color, DoubleSide, Group, Matrix3, Mesh, ShaderMaterial, Vector3, Vector4 } from 'three'
import type { PlanetStyle } from '../domain/types'
import { sphereGeo } from './geometry'
import { runtime } from './runtime'
import { atmosphereVertex, cloudFragment, glowFragment, planetFragment, planetVertex } from './shaders/planet'
import type { QualityProfile } from './quality'
import { hashString } from './math'

/** Mutable control block the parent writes every frame (no React re-renders). */
export interface BodyCtl {
  opacity: number
  /** direction from the body towards its light source (world space, normalised) */
  light: Vector3
  /** brightness multiplier on the surface */
  dim: number
}

export function makeCtl(): BodyCtl {
  return { opacity: 1, light: new Vector3(1, 0.3, 0.4).normalize(), dim: 1 }
}

const seedVec = (seed: number) =>
  new Vector3(hashString(`a${seed}`) * 40, hashString(`b${seed}`) * 40, hashString(`c${seed}`) * 40)

const GLOW: Record<string, { r: number; power: number; k: number } | undefined> = {
  haze: { r: 1.24, power: 1.7, k: 1.0 },
  halo: { r: 1.075, power: 3.4, k: 1.9 },
  aurora: { r: 1.14, power: 2.3, k: 0.55 },
  storm: { r: 1.11, power: 2.5, k: 0.5 },
  clouds: { r: 1.13, power: 2.3, k: 0.6 },
}

const KIND_ID: Record<string, number> = { aurora: 3, storm: 4, clouds: 5 }

interface Props {
  style: PlanetStyle
  radius: number
  ctl: BodyCtl
  quality: QualityProfile
  /** radians / second around the polar axis */
  spin?: number
}

export function PlanetBody({ style, radius, ctl, quality, spin = 0.05 }: Props) {
  const surface = useRef<Mesh>(null)
  const root = useRef<Group>(null)

  const surfaceMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: planetVertex,
        fragmentShader: planetFragment,
        transparent: true,
        uniforms: {
          uA: { value: new Color() },
          uB: { value: new Color() },
          uC: { value: new Color() },
          uSeedV: { value: new Vector3() },
          uSeed: { value: 0 },
          uScale: { value: 0.5 },
          uTurb: { value: 0.5 },
          uCover: { value: 0.5 },
          uMix: { value: new Vector4(1, 0, 0, 0) },
          uLightDir: { value: new Vector3(1, 0.3, 0.4) },
          uAtmo: { value: new Color() },
          uAtmoI: { value: 0.7 },
          uTime: { value: 0 },
          uOpacity: { value: 1 },
          uDim: { value: 1 },
          uOct: { value: 5 },
          uBump: { value: 1 },
          uNormalMat: { value: new Matrix3() },
        },
      }),
    [],
  )

  const glowMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: atmosphereVertex,
        fragmentShader: glowFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: BackSide,
        uniforms: {
          uColor: { value: new Color() },
          uIntensity: { value: 1 },
          uPower: { value: 2 },
          uLightDir: { value: new Vector3(1, 0.3, 0.4) },
          uOpacity: { value: 1 },
        },
      }),
    [],
  )

  const cloudMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: atmosphereVertex,
        fragmentShader: cloudFragment,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color() },
          uIntensity: { value: 1 },
          uTime: { value: 0 },
          uSeed: { value: 0 },
          uSeedV: { value: new Vector3() },
          uLightDir: { value: new Vector3(1, 0.3, 0.4) },
          uOpacity: { value: 1 },
          uKind: { value: 5 },
          uOct: { value: 4 },
        },
      }),
    [],
  )

  const atm = style.atmosphere
  const glowDef = atm.kind === 'none' ? undefined : GLOW[atm.kind]
  const layerKind = atm.kind === 'aurora' || atm.kind === 'storm' || atm.kind === 'clouds' ? atm.kind : null

  // static (style-dependent) uniforms
  useEffect(() => {
    const u = surfaceMat.uniforms
    u.uA!.value.set(style.colors.primary)
    u.uB!.value.set(style.colors.secondary)
    u.uC!.value.set(style.colors.accent)
    u.uSeedV!.value.copy(seedVec(style.seed))
    u.uSeed!.value = style.seed % 997
    u.uScale!.value = style.detail
    u.uTurb!.value = style.turbulence
    u.uCover!.value = style.coverage
    u.uMix!.value.set(style.mix.rock, style.mix.gas, style.mix.ocean, style.mix.tech)
    u.uAtmo!.value.set(atm.color)
    u.uAtmoI!.value = atm.kind === 'none' ? 0 : atm.intensity
    u.uOct!.value = quality.shaderOctaves
    u.uBump!.value = quality.tier === 'low' ? 0 : 1

    if (glowDef) {
      glowMat.uniforms.uColor!.value.set(atm.color)
      glowMat.uniforms.uIntensity!.value = glowDef.k * (0.35 + atm.intensity * 1.0) * quality.glow
      glowMat.uniforms.uPower!.value = glowDef.power
    }
    if (layerKind) {
      const c = cloudMat.uniforms
      c.uColor!.value.set(atm.color)
      c.uIntensity!.value = 0.35 + atm.intensity * 0.65
      c.uSeedV!.value.copy(seedVec(style.seed + 7))
      c.uSeed!.value = style.seed % 997
      c.uKind!.value = KIND_ID[layerKind]!
      c.uOct!.value = Math.max(3, quality.shaderOctaves - 1)
    }
  }, [style, quality, surfaceMat, glowMat, cloudMat, atm.color, atm.intensity, atm.kind, glowDef, layerKind])

  useEffect(
    () => () => {
      surfaceMat.dispose()
      glowMat.dispose()
      cloudMat.dispose()
    },
    [surfaceMat, glowMat, cloudMat],
  )

  useFrame((_, dt) => {
    const t = runtime.time
    const u = surfaceMat.uniforms
    u.uTime!.value = t
    u.uOpacity!.value = ctl.opacity
    u.uDim!.value = ctl.dim
    u.uLightDir!.value.copy(ctl.light)
    glowMat.uniforms.uLightDir!.value.copy(ctl.light)
    glowMat.uniforms.uOpacity!.value = ctl.opacity
    const c = cloudMat.uniforms
    c.uTime!.value = t
    c.uOpacity!.value = ctl.opacity
    c.uLightDir!.value.copy(ctl.light)
    if (root.current) root.current.visible = ctl.opacity > 0.003
    if (surface.current) {
      if (!runtime.reducedMotion) surface.current.rotation.y += spin * dt
      u.uNormalMat!.value.getNormalMatrix(surface.current.matrixWorld)
    }
  })

  const geo = sphereGeo(quality.sphereSegments)
  const showLayer = layerKind && (quality.atmosphereLayers || layerKind === 'aurora')

  return (
    <group ref={root} rotation={[0, 0, style.tilt]} scale={radius}>
      <mesh ref={surface} geometry={geo} material={surfaceMat} />
      {showLayer && <mesh geometry={geo} material={cloudMat} scale={layerKind === 'aurora' ? 1.035 : 1.016} />}
      {glowDef && <mesh geometry={sphereGeo(Math.min(48, quality.sphereSegments))} material={glowMat} scale={glowDef.r} />}
    </group>
  )
}
