import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Mesh, PointsMaterial, ShaderMaterial, Vector3 } from 'three'
import { removeBurst, uiStore, type Burst } from '../state/uiStore'
import { useStore } from '../state/store'
import { quadGeo } from './geometry'
import { clamp01, easeOutCubic } from './math'
import { runtime } from './runtime'
import { billboardVertex, glowSpriteFragment, shockFragment } from './shaders/misc'

/** Soft camera-facing glow: urgency beacons, selection halos, flashes. */
export function Beacon({
  size,
  color,
  power = 2,
  intensity,
  position,
  renderOrder = 6,
}: {
  size: number
  color: string
  power?: number
  /** evaluated every frame; return 0 to hide */
  intensity: () => number
  position?: [number, number, number]
  renderOrder?: number
}) {
  const mesh = useRef<Mesh>(null)
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
          uIntensity: { value: 1 },
          uPower: { value: power },
          uOpacity: { value: 1 },
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => {
    mat.uniforms.uSize!.value = size
    mat.uniforms.uColor!.value.set(color)
    mat.uniforms.uPower!.value = power
  }, [mat, size, color, power])
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(() => {
    const v = intensity()
    mat.uniforms.uIntensity!.value = v
    if (mesh.current) mesh.current.visible = v > 0.01
  })
  return <mesh ref={mesh} geometry={quadGeo()} material={mat} position={position} frustumCulled={false} renderOrder={renderOrder} />
}

/* ---------------------------------------------------------------- bursts */

const DURATION: Record<Burst['kind'], number> = { complete: 1.9, launch: 1.1, form: 3.6 }

function anchorKey(b: Burst) {
  return `${b.target.kind === 'planet' ? 'p' : b.target.kind === 'group' ? 'g' : 't'}:${b.target.id}`
}

function randomDirs(count: number) {
  return Array.from({ length: count }, () => {
    const u = Math.random() * 2 - 1
    const t = Math.random() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    return { d: new Vector3(s * Math.cos(t), u, s * Math.sin(t)), v: 0.55 + Math.random() * 0.9, spin: (Math.random() - 0.5) * 2 }
  })
}

function BurstFx({ burst }: { burst: Burst }) {
  const group = useRef<Group>(null)
  const startedAt = useRef<number | null>(null)
  const count = burst.kind === 'form' ? 150 : burst.kind === 'complete' ? 56 : 18

  const { geo, dirs, pointMat, ringMat, glowMat } = useMemo(() => {
    const geo = new BufferGeometry()
    const arr = new Float32Array(count * 3)
    geo.setAttribute('position', new BufferAttribute(arr, 3))
    const dirs = randomDirs(count)
    const pointMat = new PointsMaterial({ size: 0.16, color: new Color(burst.color), transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true })
    const ringMat = new ShaderMaterial({
      vertexShader: billboardVertex,
      fragmentShader: shockFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uSize: { value: 1 }, uColor: { value: new Color(burst.color) }, uProgress: { value: 0 }, uOpacity: { value: 1 } },
    })
    const glowMat = new ShaderMaterial({
      vertexShader: billboardVertex,
      fragmentShader: glowSpriteFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uSize: { value: 1 }, uColor: { value: new Color(burst.color) }, uIntensity: { value: 1 }, uPower: { value: 2 }, uOpacity: { value: 1 } },
    })
    return { geo, dirs, pointMat, ringMat, glowMat }
  }, [count, burst.color])

  useEffect(
    () => () => {
      geo.dispose()
      pointMat.dispose()
      ringMat.dispose()
      glowMat.dispose()
    },
    [geo, pointMat, ringMat, glowMat],
  )

  useFrame(() => {
    const g = group.current
    if (!g) return
    const key = anchorKey(burst)
    const p = runtime.pos.get(key)
    if (!p) {
      g.visible = false
      if (performance.now() - burst.at > 2500) removeBurst(burst.key)
      return
    }
    if (startedAt.current === null) startedAt.current = performance.now()
    const dur = DURATION[burst.kind]
    const age = (performance.now() - startedAt.current) / 1000
    if (age > dur) return removeBurst(burst.key)
    g.visible = true
    g.position.copy(p)
    const R = Math.max(0.3, runtime.size.get(key) ?? 1)
    const k = age / dur
    const attr = geo.getAttribute('position') as BufferAttribute

    if (burst.kind === 'form') {
      // accretion: matter spirals in, then a bright release
      const gather = clamp01(age / 1.9)
      const release = clamp01((age - 1.9) / 1.7)
      dirs.forEach((o, i) => {
        const inward = 1 - easeOutCubic(gather)
        const rad = R * (1.05 + inward * 6.5 * o.v) + release * R * 3.2 * o.v
        const ang = o.spin * (1 - gather) * 3.2
        const c = Math.cos(ang)
        const s = Math.sin(ang)
        attr.setXYZ(i, (o.d.x * c - o.d.z * s) * rad, o.d.y * rad, (o.d.x * s + o.d.z * c) * rad)
      })
      pointMat.opacity = (gather < 1 ? 0.15 + gather * 0.85 : 1 - release) * 0.9
      pointMat.size = 0.12 * Math.max(1, R)
      const flash = Math.exp(-Math.pow((age - 1.95) * 2.4, 2))
      glowMat.uniforms.uSize!.value = R * 7
      glowMat.uniforms.uIntensity!.value = 0.2 + flash * 1.3
      glowMat.uniforms.uOpacity!.value = 1 - clamp01((age - 2.6) / 1)
      ringMat.uniforms.uSize!.value = R * 9
      ringMat.uniforms.uProgress!.value = clamp01((age - 1.9) / 1.6)
      ringMat.uniforms.uOpacity!.value = age > 1.9 ? 1 : 0
    } else {
      const spread = easeOutCubic(k)
      dirs.forEach((o, i) => {
        const rad = (R * 1.1 + spread * (burst.kind === 'complete' ? 2.4 : 1.1) * o.v) * (burst.kind === 'complete' ? 1.4 : 1)
        attr.setXYZ(i, o.d.x * rad, o.d.y * rad, o.d.z * rad)
      })
      pointMat.opacity = (1 - k) * 0.95
      pointMat.size = 0.09 + 0.05 * (1 - k)
      glowMat.uniforms.uSize!.value = R * (burst.kind === 'complete' ? 6 : 3.5)
      glowMat.uniforms.uIntensity!.value = (1 - k) * (burst.kind === 'complete' ? 0.9 : 0.5)
      ringMat.uniforms.uSize!.value = R * (burst.kind === 'complete' ? 9 : 6)
      ringMat.uniforms.uProgress!.value = k
      ringMat.uniforms.uOpacity!.value = 1
    }
    attr.needsUpdate = true
  })

  return (
    <group ref={group} visible={false}>
      <mesh geometry={quadGeo()} material={glowMat} frustumCulled={false} renderOrder={8} />
      <mesh geometry={quadGeo()} material={ringMat} frustumCulled={false} renderOrder={8} />
      <points geometry={geo} material={pointMat} frustumCulled={false} renderOrder={9} />
    </group>
  )
}

export function Bursts() {
  const bursts = useStore(uiStore, (s) => s.bursts)
  return (
    <>
      {bursts.map((b) => (
        <BurstFx key={b.key} burst={b} />
      ))}
    </>
  )
}
