import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Group, ShaderMaterial, Vector3 } from 'three'
import { haloContent, HALO } from '../domain/overview'
import { planetRadius, TAU } from '../domain/layout'
import { urgencyOf } from '../domain/time'
import type { Group as GroupData, Planet, Task } from '../domain/types'
import { clockStore } from '../state/clock'
import { useStore } from '../state/store'
import { Beacon } from './Effects'
import { hashString } from './math'
import { forgetAnchor, anchor, runtime } from './runtime'
import { haloPointFragment, haloPointVertex, orbitFragment, orbitVertex } from './shaders/misc'
import { STATUS_COLOR } from './Satellites'

/**
 * Summary of a planet drawn inside the scene while it is only hovered or approached: one thin ring
 * per busy group (in the group's colour), the group as a brighter dot and its most important open
 * tasks as small dots on the same ring. No panels: association comes from the shared ring.
 */

const URGENT_COLOR = ['', '#ffd36b', '#ffa247', '#ff5a4a']
const TILT = 0.38
const OFFSETS = [0.46, -0.46, 0.92, -0.92, 1.38]

interface Item {
  groupIndex: number
  /** angular offset from the group dot */
  offset: number
  task: Task | null
  group: GroupData
}

export function PlanetHalo({ planet, allGroups, allTasks }: { planet: Planet; allGroups: GroupData[]; allTasks: Task[] }) {
  const groups = useMemo(() => allGroups.filter((g) => g.planetId === planet.id), [allGroups, planet.id])
  const tasks = useMemo(() => allTasks.filter((t) => t.planetId === planet.id), [allTasks, planet.id])
  const { gl } = useThree()
  const now = useStore(clockStore, (s) => s.now)
  const R = planetRadius(planet.style.size)
  const content = useMemo(() => haloContent(groups, tasks, now), [groups, tasks, now])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    content.forEach((c, groupIndex) => {
      out.push({ groupIndex, offset: 0, task: null, group: c.group })
      c.tasks.forEach((task, k) => out.push({ groupIndex, offset: OFFSETS[k] ?? 1.6, task, group: c.group }))
    })
    return out
  }, [content])

  const holder = useRef<Group>(null)
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
  const ringMats = useMemo(
    () =>
      content.map(
        (c) =>
          new ShaderMaterial({
            vertexShader: orbitVertex,
            fragmentShader: orbitFragment,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            uniforms: { uColor: { value: new Color(c.group.color) }, uOpacity: { value: 0 }, uTime: { value: 0 }, uDash: { value: 0 } },
          }),
      ),
    [content],
  )
  const ringGeos = useMemo(
    () =>
      content.map((_, i) => {
        const r = ringRadius(R, i)
        const pts: number[] = []
        for (let k = 0; k < 120; k++) pts.push(Math.cos((k / 120) * TAU) * r, 0, Math.sin((k / 120) * TAU) * r)
        const g = new BufferGeometry()
        g.setAttribute('position', new Float32BufferAttribute(pts, 3))
        return g
      }),
    [content, R],
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
      c.set(it.task ? taskColor(it.task, now) : it.group.color)
      col.set([c.r, c.g, c.b], i * 3)
    })
    g.setAttribute('aColor', new BufferAttribute(col, 3))
    g.setDrawRange(0, items.length)
    return g
    // colours follow the data; the clock only matters for urgency tint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const keys = useMemo(() => items.map((it) => (it.task ? `ht:${it.task.id}` : `hg:${it.group.id}`)), [items])
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
  useEffect(
    () => () => {
      for (const m of ringMats) m.dispose()
      for (const g of ringGeos) g.dispose()
    },
    [ringMats, ringGeos],
  )

  const tmp = useMemo(() => new Vector3(), [])
  const dpr = gl.getPixelRatio()
  useFrame(() => {
    const h = holder.current
    const center = runtime.pos.get(`p:${planet.id}`)
    const level = runtime.halo.get(planet.id) ?? 0
    if (!h || !center) return
    glowRef.current?.position.copy(center)
    h.visible = level > 0.01
    if (!h.visible) return
    h.position.copy(center)
    h.updateWorldMatrix(true, false)
    const cam = runtime.camera
    const H = runtime.height
    pointMat.uniforms.uScale!.value = cam ? ((H / 2) / Math.tan((cam.fov * Math.PI) / 360)) * dpr : 1
    pointMat.uniforms.uOpacity!.value = level
    ringMats.forEach((m) => (m.uniforms.uOpacity!.value = 0.34 * level))
    const pos = geo.getAttribute('position') as BufferAttribute
    const size = geo.getAttribute('aSize') as BufferAttribute
    const alpha = geo.getAttribute('aAlpha') as BufferAttribute
    items.forEach((it, i) => {
      const r = ringRadius(R, it.groupIndex)
      const speed = 0.16 / (1 + it.groupIndex * 0.3)
      const a = hashString(it.group.id) * TAU + (runtime.reducedMotion ? 0 : runtime.tU * speed) + it.offset
      tmp.set(Math.cos(a) * r, 0, Math.sin(a) * r)
      pos.setXYZ(i, tmp.x, tmp.y, tmp.z)
      // the same point in world space is what labels attach to
      tmp.applyMatrix4(h.matrixWorld)
      anchor(keys[i]!).copy(tmp)
      runtime.size.set(keys[i]!, it.task ? 0.16 : 0.26)
      size.setX(i, it.task ? 0.34 : 0.62)
      alpha.setX(i, it.task ? 0.92 : 1)
    })
    pos.needsUpdate = true
    size.needsUpdate = true
    alpha.needsUpdate = true
  })

  // the soft highlight of the planet itself: only the part of the level above the "overview" plateau
  const glow = () => Math.max(0, ((runtime.halo.get(planet.id) ?? 0) - 0.45) / 0.55) * 0.34

  return (
    <group>
      <group ref={glowRef}>
        <Beacon size={R * 3.1} color="#bcd6ff" power={2.6} intensity={glow} renderOrder={5} />
      </group>
      <group ref={holder} rotation={[TILT, 0, 0]} visible={false}>
        {ringGeos.map((g, i) => (
          <lineLoop
            key={content[i]!.group.id}
            geometry={g}
            material={ringMats[i]!}
            frustumCulled={false}
            renderOrder={-4}
          />
        ))}
        <points geometry={geo} material={pointMat} frustumCulled={false} renderOrder={7} />
      </group>
    </group>
  )
}

const ringRadius = (R: number, i: number) => R * 1.75 + 1.0 + i * 0.62

export const HALO_REACH = (R: number) => ringRadius(R, HALO.maxGroups - 1)

function taskColor(t: Task, now: number): string {
  const u = urgencyOf(t, now)
  return u >= 1 ? URGENT_COLOR[u]! : STATUS_COLOR[t.status]
}

