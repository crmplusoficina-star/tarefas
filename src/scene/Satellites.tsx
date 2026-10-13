import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Color, Group, LineLoop, Mesh, MeshStandardMaterial, ShaderMaterial, Vector3, Float32BufferAttribute, AdditiveBlending } from 'three'
import { BAND_ORDER, layoutTasks, TAU, type Band, type SatSlot } from '../domain/layout'
import { subtaskProgress } from '../domain/stats'
import { urgencyOf } from '../domain/time'
import type { Priority, Status, Task } from '../domain/types'
import { selectTask } from '../state/commands'
import { clockStore } from '../state/clock'
import { levelOf, uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { Beacon } from './Effects'
import { FaceCamera } from './FaceCamera'
import { sphereGeo } from './geometry'
import { clamp01, damp, dampAngle, easeOutBack } from './math'
import { ProgressRing } from './ProgressRing'
import type { QualityProfile } from './quality'
import { anchor, forgetAnchor, runtime } from './runtime'
import { orbitFragment, orbitVertex } from './shaders/misc'

const URGENCY_COLOR = ['#000000', '#ffd36b', '#ffa247', '#ff5a4a']
const PRIORITY_SCALE: Record<Priority, number> = { critical: 2.3, high: 1.95, medium: 1.65, low: 1.4 }
const BAND_TILT: Record<Band, number> = { critical: -0.1, high: 0.16, medium: -0.2, low: 0.12, done: 0.04 }

export const STATUS_COLOR: Record<Status, string> = {
  todo: '#8e9bb3',
  doing: '#7fb4ff',
  blocked: '#e0a24c',
  done: '#9fe3c8',
}

/** position on a tilted circular orbit (matches `rotation.x = tilt` of a flat ring) */
export function orbitPoint(out: Vector3, radius: number, angle: number, tilt: number) {
  const x = Math.cos(angle) * radius
  const z0 = Math.sin(angle) * radius
  return out.set(x, -z0 * Math.sin(tilt), z0 * Math.cos(tilt))
}

/* -------------------------------------------------------------- materials */

function useSatMaterials() {
  return useMemo(() => {
    const body = new MeshStandardMaterial({ color: '#cfd5e2', emissive: new Color('#39445a'), emissiveIntensity: 0.55, metalness: 0.45, roughness: 0.4 })
    const panel: Record<Status, MeshStandardMaterial> = {
      todo: new MeshStandardMaterial({ color: '#2a3446', emissive: new Color('#1d2635'), emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.5 }),
      doing: new MeshStandardMaterial({ color: '#2a4f8f', emissive: new Color('#3c78d8'), emissiveIntensity: 0.75, metalness: 0.5, roughness: 0.3 }),
      blocked: new MeshStandardMaterial({ color: '#6b4a1e', emissive: new Color('#c8862a'), emissiveIntensity: 0.55, metalness: 0.5, roughness: 0.4 }),
      done: new MeshStandardMaterial({ color: '#2f6f5e', emissive: new Color('#52d2a8'), emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.3 }),
    }
    const simple: Record<Status, MeshStandardMaterial> = {
      todo: new MeshStandardMaterial({ color: '#8e9bb3', emissive: new Color('#8e9bb3'), emissiveIntensity: 0.25, roughness: 0.6 }),
      doing: new MeshStandardMaterial({ color: '#7fb4ff', emissive: new Color('#7fb4ff'), emissiveIntensity: 0.6, roughness: 0.5 }),
      blocked: new MeshStandardMaterial({ color: '#e0a24c', emissive: new Color('#e0a24c'), emissiveIntensity: 0.5, roughness: 0.5 }),
      done: new MeshStandardMaterial({ color: '#9fe3c8', emissive: new Color('#9fe3c8'), emissiveIntensity: 0.7, roughness: 0.5 }),
    }
    return { body, panel, simple }
  }, [])
}
type Mats = ReturnType<typeof useSatMaterials>

/* -------------------------------------------------------------- satellite */

interface SatProps {
  task: Task
  slot: SatSlot
  bandTilt: number
  center: string
  quality: QualityProfile
  mats: Mats
  group: { current: Group | null }
  /** 0..1 how much of the system is shown (fades while flying elsewhere) */
  presence: { current: number }
}

function Satellite({ task, slot, bandTilt, center, quality, mats, presence }: SatProps) {
  const root = useRef<Group>(null)
  const model = useRef<Group>(null)
  const dish = useRef<Group>(null)
  const hit = useRef<Mesh>(null)
  const key = `t:${task.id}`
  const st = useRef({ radius: slot.radius * 2.4, angle: slot.phase, scale: 0, ready: false, born: 0, lift: 1, doneBlend: task.status === 'done' ? 1 : 0, hover: 0, select: 0 })
  const taskRef = useRef(task)
  taskRef.current = task
  const slotRef = useRef(slot)
  slotRef.current = slot
  const tiltRef = useRef(bandTilt)
  tiltRef.current = bandTilt
  const tmp = useMemo(() => new Vector3(), [])
  const now = useStore(clockStore, (s) => s.now)
  const urg = urgencyOf(task, now)
  const sub = subtaskProgress(task)
  const hasSub = task.subtasks.length > 0
  const s0 = PRIORITY_SCALE[task.priority]

  useEffect(() => () => forgetAnchor(key), [key])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const g = root.current
    if (!g) return
    const t = taskRef.current
    const sl = slotRef.current
    const o = st.current
    const centerPos = runtime.pos.get(center)
    if (!centerPos) return
    const tAngle = sl.phase + sl.omega * runtime.tG
    if (!o.ready) {
      o.angle = tAngle
      o.ready = true
    }
    o.angle = dampAngle(o.angle, tAngle, 5, dt)
    o.radius = damp(o.radius, sl.radius, runtime.reducedMotion ? 30 : 3.2, dt)
    // launch: grow in from the outside
    if (!o.born) o.born = performance.now()
    const age = (performance.now() - o.born) / 1000
    const intro = runtime.reducedMotion ? 1 : easeOutBack(clamp01(age / 0.9))
    const ui = uiStore.get()
    const isSel = ui.taskId === t.id
    const isHover = ui.hover?.kind === 'task' && ui.hover.id === t.id
    o.hover = damp(o.hover, isHover ? 1 : 0, 10, dt)
    o.select = damp(o.select, isSel ? 1 : 0, 6, dt)
    o.doneBlend = damp(o.doneBlend, t.status === 'done' ? 1 : 0, 3, dt)
    o.scale = s0 * intro * (1 + o.hover * 0.28 + o.select * 0.18)

    orbitPoint(tmp, o.radius, o.angle, tiltRef.current).add(centerPos)
    g.position.copy(tmp)
    anchor(key).copy(tmp)
    runtime.size.set(key, 0.2 * s0)
    g.scale.setScalar(Math.max(0.0001, o.scale) * presence.current)
    g.visible = presence.current > 0.02
    if (hit.current) hit.current.raycast = presence.current > 0.7 ? Mesh.prototype.raycast : () => {}

    if (model.current) {
      model.current.rotation.y = -o.angle
      if (!runtime.reducedMotion) model.current.rotation.z = Math.sin(runtime.time * 0.5 + sl.phase * 3) * 0.1
    }
    if (dish.current && !runtime.reducedMotion) dish.current.rotation.y += dt * (t.status === 'doing' ? 2.2 : 0.3)
  })

  const hover = (on: boolean) => {
    if (!on) {
      runtime.hovering = false
      document.body.style.cursor = ''
      const h = uiStore.get().hover
      if (h?.kind === 'task' && h.id === task.id) uiStore.set({ hover: null })
      return
    }
    runtime.hovering = true
    document.body.style.cursor = 'pointer'
    uiStore.set({ hover: { kind: 'task', id: task.id } })
  }

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (runtime.dragMoved) return
    selectTask(task.id)
  }

  const beaconColor = urg > 0 ? URGENCY_COLOR[urg]! : task.status === 'blocked' ? '#e0a24c' : STATUS_COLOR[task.status]
  const beaconBase = urg > 0 ? 0.9 + urg * 0.25 : task.status === 'blocked' ? 0.6 : task.status === 'doing' ? 0.45 : task.status === 'done' ? 0.5 : 0.22

  return (
    <group ref={root}>
      <group ref={model}>
        {quality.detailedSatellites ? (
          <>
            <mesh material={mats.body}>
              <boxGeometry args={[0.17, 0.17, 0.27]} />
            </mesh>
            {[-1, 1].map((s) => (
              <group key={s}>
                <mesh material={mats.body} position={[s * 0.13, 0, 0]}>
                  <boxGeometry args={[0.1, 0.014, 0.014]} />
                </mesh>
                <mesh material={mats.panel[task.status]} position={[s * 0.31, 0, 0]}>
                  <boxGeometry args={[0.28, 0.012, task.status === 'done' ? 0.1 : 0.16]} />
                </mesh>
              </group>
            ))}
            <group ref={dish} position={[0, 0.13, -0.02]}>
              <mesh material={mats.body} rotation={[Math.PI / 2.4, 0, 0]}>
                <coneGeometry args={[0.075, 0.07, 18, 1, true]} />
              </mesh>
              <mesh material={mats.body} position={[0, -0.03, 0]}>
                <cylinderGeometry args={[0.008, 0.008, 0.06, 6]} />
              </mesh>
            </group>
          </>
        ) : (
          <mesh geometry={sphereGeo(10)} material={mats.simple[task.status]} scale={0.15} />
        )}
      </group>
      <Beacon
        position={[0, 0.2, 0]}
        size={0.5 + urg * 0.16}
        color={beaconColor}
        power={2.4}
        intensity={() => {
          const rate = urg === 3 ? 5 : urg === 2 ? 3 : urg === 1 ? 1.7 : task.status === 'blocked' ? 1.2 : 0.9
          const wave = runtime.reducedMotion ? 0.85 : 0.6 + 0.4 * Math.sin(runtime.time * rate + slot.phase * 5)
          return beaconBase * wave * presence.current * (1 + st.current.select * 0.5 + st.current.hover * 0.5)
        }}
      />
      {hasSub && (
        <FaceCamera>
          <ProgressRing radius={0.42} thickness={0.018} progress={() => sub} opacity={() => presence.current * 0.95} color={task.status === 'done' ? '#9fe3c8' : '#e9c98d'} trackAlpha={0.18} />
        </FaceCamera>
      )}
      {task.status === 'done' && (
        <FaceCamera>
          <ProgressRing radius={0.55} thickness={0.012} progress={() => 1} opacity={() => presence.current * st.current.doneBlend * 0.55} color="#9fe3c8" trackAlpha={0} />
        </FaceCamera>
      )}
      <Beacon
        size={1.9}
        color="#fff1cf"
        power={3}
        renderOrder={5}
        intensity={() => st.current.select * 0.55 * presence.current}
      />
      <mesh ref={hit} geometry={sphereGeo(10)} scale={0.34} onPointerOver={(e) => (e.stopPropagation(), hover(true))} onPointerOut={() => hover(false)} onClick={onClick}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------- band rings */

function BandRing({ radius, tilt, center, presence }: { radius: number; tilt: number; center: string; presence: { current: number } }) {
  const ref = useRef<LineLoop>(null)
  const geo = useMemo(() => {
    const pts: number[] = []
    const n = 160
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU
      pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts, 3))
    return g
  }, [radius])
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: orbitVertex,
        fragmentShader: orbitFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uColor: { value: new Color('#9fb4d8') }, uOpacity: { value: 0.1 }, uTime: { value: 0 }, uDash: { value: 1 } },
      }),
    [],
  )
  useEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  useFrame(() => {
    const p = runtime.pos.get(center)
    const l = ref.current
    if (!l || !p) return
    l.position.copy(p)
    mat.uniforms.uOpacity!.value = 0.11 * presence.current
    l.visible = presence.current > 0.02
  })
  return <lineLoop ref={ref} geometry={geo} material={mat} rotation={[tilt, 0, 0]} frustumCulled={false} renderOrder={-5} />
}

/* ----------------------------------------------------------- the system */

export function SatelliteSystem({ groupId, tasks, quality, centerKey }: { groupId: string; tasks: Task[]; quality: QualityProfile; centerKey: string }) {
  const mats = useSatMaterials()
  useEffect(
    () => () => {
      mats.body.dispose()
      Object.values(mats.panel).forEach((m) => m.dispose())
      Object.values(mats.simple).forEach((m) => m.dispose())
    },
    [mats],
  )
  const layout = useMemo(() => layoutTasks(tasks), [tasks])
  const active = useStore(uiStore, (s) => s.groupId === groupId && !s.lab)
  const presence = useRef({ current: 0 })
  const dummy = useRef<Group>(null)
  useFrame((_, dt) => {
    const target = active ? 1 : 0
    presence.current.current = runtime.reducedMotion ? target : damp(presence.current.current, target, active ? 2.6 : 5, dt)
    const c = runtime.pos.get(centerKey)
    if (c) anchor('center').copy(c)
    // band label anchors sit on the screen-right side of each ring
    for (const b of layout.bands) {
      const r = b.inner
      const a = -runtime.cam.az
      orbitPoint(anchor(`b:${b.band}`), r, a, BAND_TILT[b.band])
      anchor(`b:${b.band}`).add(c ?? anchor('center'))
    }
  })
  useEffect(
    () => () => {
      forgetAnchor('center')
      BAND_ORDER.forEach((b) => forgetAnchor(`b:${b}`))
    },
    [],
  )

  const pairs = useMemo(() => {
    const seen = new Set<string>()
    const out: [string, string][] = []
    for (const t of tasks)
      for (const l of t.links) {
        const k = [t.id, l].sort().join('|')
        if (seen.has(k)) continue
        seen.add(k)
        out.push([`t:${t.id}`, `t:${l}`])
      }
    return out
  }, [tasks])

  return (
    <group ref={dummy}>
      {layout.bands.map((b) => {
        const rings: number[] = []
        for (let r = b.inner; r <= b.outer + 0.01; r += 0.6) rings.push(r)
        return rings.map((r, i) => <BandRing key={`${b.band}${i}`} radius={r} tilt={BAND_TILT[b.band]} center={centerKey} presence={presence.current} />)
      })}
      {tasks.map((t) => {
        const slot = layout.slots.get(t.id)
        if (!slot) return null
        return <Satellite key={t.id} task={t} slot={slot} bandTilt={BAND_TILT[slot.band]} center={centerKey} quality={quality} mats={mats} group={dummy} presence={presence.current} />
      })}
      <LinkLinesGate pairs={pairs} presence={presence.current} />
    </group>
  )
}

import { LinkLines } from './LinkLines'
function LinkLinesGate({ pairs, presence }: { pairs: [string, string][]; presence: { current: number } }) {
  const level = useStore(uiStore, (s) => levelOf(s))
  return <LinkLines pairs={pairs} opacity={() => presence.current * (level === 'task' ? 0.9 : 0.75)} />
}
