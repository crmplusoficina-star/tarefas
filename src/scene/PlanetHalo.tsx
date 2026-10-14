import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, ShaderMaterial } from 'three'
import { haloContent } from '../domain/overview'
import { planetRadius } from '../domain/layout'
import { urgencyOf } from '../domain/time'
import type { Group as GroupData, Planet, Task } from '../domain/types'
import { clockStore } from '../state/clock'
import { useStore } from '../state/store'
import { Beacon } from './Effects'
import { forgetAnchor, anchor, runtime } from './runtime'
import { haloPointFragment, haloPointVertex } from './shaders/misc'
import { STATUS_COLOR } from './Satellites'

/**
 * Task summary of a planet while it is hovered or approached from the universe: a soft glow around
 * the planet and, along each moon's own orbit, small dots for that group's most important open
 * tasks (colour = urgency/status). There are no extra rings or panels: the moons and their orbits
 * are the planet's real ones, the dots simply travel with them.
 */

const URGENT_COLOR = ['', '#ffd36b', '#ffa247', '#ff5a4a']
/** distance (world units, along the orbit) between neighbouring dots next to a moon */
const SPACING = 0.5

interface Item {
  task: Task
  group: GroupData
  /** 1, -1, 2, -2 … steps along the orbit from the moon */
  step: number
}

export function PlanetHalo({ planet, allGroups, allTasks }: { planet: Planet; allGroups: GroupData[]; allTasks: Task[] }) {
  const { gl } = useThree()
  const groups = useMemo(() => allGroups.filter((g) => g.planetId === planet.id), [allGroups, planet.id])
  const tasks = useMemo(() => allTasks.filter((t) => t.planetId === planet.id), [allTasks, planet.id])
  const now = useStore(clockStore, (s) => s.now)
  const R = planetRadius(planet.style.size)
  const content = useMemo(() => haloContent(groups, tasks, now), [groups, tasks, now])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (const c of content) c.tasks.forEach((task, k) => out.push({ task, group: c.group, step: (k % 2 === 0 ? 1 : -1) * (Math.floor(k / 2) + 1) }))
    return out
  }, [content])

  const glowRef = useRef<Group>(null)

  const pointMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: haloPointVertex,
        fragmentShader: haloPointFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uScale: { value: 1 }, uOpacity: { value: 0 } },
      }),
    [],
  )
  const geo = useMemo(() => {
    const g = new BufferGeometry()
    const n = Math.max(1, items.length)
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3))
    g.setAttribute('aSize', new BufferAttribute(new Float32Array(n), 1))
    g.setAttribute('aAlpha', new BufferAttribute(new Float32Array(n), 1))
    const col = new Float32Array(n * 3)
    const c = new Color()
    items.forEach((it, i) => {
      c.set(taskColor(it.task, now))
      col.set([c.r, c.g, c.b], i * 3)
    })
    g.setAttribute('aColor', new BufferAttribute(col, 3))
    g.setDrawRange(0, items.length)
    return g
    // colours follow the data; the clock only matters for the urgency tint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const keys = useMemo(() => items.map((it) => `ht:${it.task.id}`), [items])
  useEffect(
    () => () => {
      for (const k of keys) forgetAnchor(k)
    },
    [keys],
  )
  useEffect(
    () => () => {
      pointMat.dispose()
      geo.dispose()
    },
    [pointMat, geo],
  )

  const dpr = gl.getPixelRatio()
  useFrame(() => {
    const center = runtime.pos.get(`p:${planet.id}`)
    const level = runtime.halo.get(planet.id) ?? 0
    if (!center) return
    glowRef.current?.position.copy(center)
    const cam = runtime.camera
    pointMat.uniforms.uScale!.value = cam ? (runtime.height / 2 / Math.tan((cam.fov * Math.PI) / 360)) * dpr : 1
    pointMat.uniforms.uOpacity!.value = level
    const pos = geo.getAttribute('position') as BufferAttribute
    const size = geo.getAttribute('aSize') as BufferAttribute
    const alpha = geo.getAttribute('aAlpha') as BufferAttribute
    items.forEach((it, i) => {
      const orbit = runtime.moonOrbit.get(it.group.id)
      if (!orbit || orbit.presence < 0.5) {
        alpha.setX(i, 0)
        forgetAnchor(keys[i]!)
        return
      }
      const a = orbit.angle + (it.step * SPACING) / Math.max(0.5, orbit.radius)
      const x = Math.cos(a) * orbit.radius
      const z0 = Math.sin(a) * orbit.radius
      const wx = center.x + x
      const wy = center.y - z0 * Math.sin(orbit.tilt)
      const wz = center.z + z0 * Math.cos(orbit.tilt)
      pos.setXYZ(i, wx, wy, wz)
      anchor(keys[i]!).set(wx, wy, wz)
      runtime.size.set(keys[i]!, 0.12)
      size.setX(i, 0.3)
      alpha.setX(i, 0.95 * orbit.presence)
    })
    pos.needsUpdate = true
    size.needsUpdate = true
    alpha.needsUpdate = true
  })

  // the soft highlight of the planet itself
  const glow = () => (runtime.halo.get(planet.id) ?? 0) * 0.3

  return (
    <group>
      <group ref={glowRef}>
        <Beacon size={R * 3.1} color="#bcd6ff" power={2.6} intensity={glow} renderOrder={5} />
      </group>
      <points geometry={geo} material={pointMat} frustumCulled={false} renderOrder={7} />
    </group>
  )
}

function taskColor(t: Task, now: number): string {
  const u = urgencyOf(t, now)
  return u >= 1 ? URGENT_COLOR[u]! : STATUS_COLOR[t.status]
}
