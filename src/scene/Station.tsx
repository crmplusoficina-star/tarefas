import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, Group, MeshStandardMaterial } from 'three'
import { torusGeo, sphereGeo } from './geometry'
import { runtime } from './runtime'
import { mix, shade } from './color'
import type { BodyCtl } from './PlanetBody'

/** A modular space station: hub, spinning habitat ring, spokes, solar wings. */
export function Station({ color, radius, ctl, seed }: { color: string; radius: number; ctl: BodyCtl; seed: number }) {
  const ring = useRef<Group>(null)
  const hull = useMemo(() => new MeshStandardMaterial({ color: mix(color, '#cfd6e2', 0.55), metalness: 0.65, roughness: 0.38, transparent: true }), [color])
  const accent = useMemo(
    () => new MeshStandardMaterial({ color: shade(color, 0.7), emissive: new Color(color), emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.5, transparent: true }),
    [color],
  )
  const panel = useMemo(
    () => new MeshStandardMaterial({ color: '#233a63', emissive: new Color('#2d5aa8'), emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.35, transparent: true }),
    [],
  )
  useEffect(
    () => () => {
      hull.dispose()
      accent.dispose()
      panel.dispose()
    },
    [hull, accent, panel],
  )
  useFrame((_, dt) => {
    const o = ctl.opacity
    hull.opacity = o
    accent.opacity = o
    panel.opacity = o
    if (ring.current && !runtime.reducedMotion) ring.current.rotation.z += dt * (0.45 + (seed % 3) * 0.1)
  })
  const spokes = [0, 1, 2, 3]
  return (
    <group scale={radius}>
      <mesh geometry={sphereGeo(24)} material={hull} scale={0.34} />
      <mesh geometry={sphereGeo(16)} material={accent} scale={[0.15, 0.15, 0.5]} position={[0, 0, 0]} />
      <group ref={ring}>
        <mesh geometry={torusGeo(0.82, 0.085, 10, 56)} material={hull} />
        <mesh geometry={torusGeo(0.82, 0.03, 6, 56)} material={accent} position={[0, 0, 0.085]} />
        {spokes.map((i) => (
          <mesh key={i} material={hull} rotation={[0, 0, (i * Math.PI) / 2]} position={[Math.cos((i * Math.PI) / 2) * 0.42, Math.sin((i * Math.PI) / 2) * 0.42, 0]}>
            <boxGeometry args={[0.82, 0.035, 0.035]} />
          </mesh>
        ))}
      </group>
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0.0, s * 0.62]}>
          <mesh material={hull} position={[0, 0, -s * 0.26]}>
            <boxGeometry args={[0.03, 0.03, 0.34]} />
          </mesh>
          <mesh material={panel} position={[0, 0, s * 0.08]}>
            <boxGeometry args={[0.95, 0.015, 0.34]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
