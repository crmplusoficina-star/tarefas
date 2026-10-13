import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Color, Group, LineLoop, Mesh, MeshStandardMaterial, ShaderMaterial, Vector3, Float32BufferAttribute, AdditiveBlending } from 'three'
import { BAND_ORDER, layoutTasks, TAU, type Band, type SatSlot } from '../domain/layout'
import { OVERVIEW, overviewRadius, pickOverview } from '../domain/overview'
import { subtaskProgress } from '../domain/stats'
import { urgencyOf } from '../domain/time'
import type { Group as GroupData, Priority, Status, Task } from '../domain/types'
import { selectTask } from '../state/commands'
import { clockStore } from '../state/clock'
import { levelOf, uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { Beacon } from './Effects'
import { FaceCamera } from './FaceCamera'
import { sphereGeo } from './geometry'
import { clamp01, damp, dampAngle, easeOutBack } from './math'
import { usePickable } from './pick'
import { ProgressRing } from './ProgressRing'
import type { QualityProfile } from './quality'
import { anchor, forgetAnchor, runtime, stepDt } from './runtime'
import { LinkLines } from './LinkLines'
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
  /** 0..1 how much of the system is shown (fades while flying elsewhere) */
  presence: { current: number }
  /** 0 = seen from the planet (compact), 1 = its group is focused (full size) */
  focus: () => number
}

function Satellite({ task, slot, bandTilt, center, quality, mats, presence, focus }: SatProps) {
  const root = useRef<Group>(null)
  const model = useRef<Group>(null)
  const dish = useRef<Group>(null)
  const hit = useRef<Mesh>(null)
  const key = `t:${task.id}`
  const st = useRef({ radius: overviewRadius(slot.radius) * 2, angle: slot.phase, scale: 0, ready: false, born: 0, lift: 1, doneBlend: task.status === 'done' ? 1 : 0, hover: 0, select: 0 })
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
  usePickable(hit, key)

  useFrame((_, dtRaw) => {
    const dt = stepDt(dtRaw)
    const g = root.current
    if (!g) return
    const t = taskRef.current
    const sl = slotRef.current
    const o = st.current
    const centerPos = runtime.pos.get(center)
    if (!centerPos) return
    const tAngle = sl.phase + sl.omega * runtime.tS
    if (!o.ready) {
      o.angle = tAngle
      o.ready = true
    }
    // compact orbit around the moon while the planet is viewed as a whole; full orbit when the group is focused
    const k = focus()
    const rOverview = overviewRadius(sl.radius)
    o.angle = dampAngle(o.angle, tAngle, 5, dt)
    o.radius = damp(o.radius, rOverview + (sl.radius - rOverview) * k, runtime.reducedMotion ? 30 : 3.2, dt)
    const sizeK = OVERVIEW.satScale + (1 - OVERVIEW.satScale) * k
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
    o.scale = s0 * sizeK * intro * (1 + o.hover * (0.28 + 0.9 * (1 - k)) + o.select * 0.18)

    orbitPoint(tmp, o.radius, o.angle, tiltRef.current).add(centerPos)
    g.position.copy(tmp)
    anchor(key).copy(tmp)
    runtime.size.set(key, 0.2 * s0 * sizeK)
    g.scale.setScalar(Math.max(0.0001, o.scale) * presence.current)
    // however small the satellite is drawn, keep a comfortable target to hover and click
    if (hit.current) hit.current.scale.setScalar(Math.max(0.34, 0.32 / Math.max(0.02, g.scale.x)))
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
          // small satellites keep a stronger glint so urgent ones read from a distance
          return beaconBase * wave * presence.current * (1 + st.current.select * 0.5 + st.current.hover * 0.5 + (1 - focus()) * 0.9)
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
      <mesh ref={hit} geometry={sphereGeo(10)} onPointerOver={(e) => (e.stopPropagation(), hover(true))} onPointerOut={() => hover(false)} onClick={onClick}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------- band rings */

function BandRing({ radius, tilt, center, presence, color = '#9fb4d8', opacity = 0.11 }: { radius: number; tilt: number; center: string; presence: { current: number }; color?: string; opacity?: number }) {
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
        uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: opacity }, uTime: { value: 0 }, uDash: { value: 1 } },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => {
    mat.uniforms.uColor!.value.set(color)
  }, [mat, color])
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
    mat.uniforms.uOpacity!.value = opacity * presence.current
    l.visible = presence.current > 0.02
  })
  return <lineLoop ref={ref} geometry={geo} material={mat} rotation={[tilt, 0, 0]} frustumCulled={false} renderOrder={-5} />
}

/* ----------------------------------------------------------- the system */

/**
 * The task satellites of ONE group. Seen from the planet they orbit their moon in a compact form
 * (the most relevant tasks of the group); when the group is focused they open up into the full
 * priority bands. Several of these run side by side, one per group.
 */
export function SatelliteSystem({ group, tasks, quality, centerKey, cap }: { group: GroupData; tasks: Task[]; quality: QualityProfile; centerKey: string; cap: number }) {
  const mats = useSatMaterials()
  useEffect(
    () => () => {
      mats.body.dispose()
      Object.values(mats.panel).forEach((m) => m.dispose())
      Object.values(mats.simple).forEach((m) => m.dispose())
    },
    [mats],
  )
  const now = useStore(clockStore, (s) => s.now)
  const focused = useStore(uiStore, (s) => s.groupId === group.id)
  // the planet view draws the most relevant tasks; focusing the group reveals all of them
  const shown = useMemo(() => (focused ? tasks : pickOverview(tasks, cap, now)), [focused, tasks, cap, now])
  const layout = useMemo(() => layoutTasks(shown), [shown])
  const presence = useRef({ current: 0 })
  const ringFocus = useRef({ current: 0 })
  const ringOverview = useRef({ current: 0 })
  const focus = useMemo(() => () => runtime.moonFocus.get(group.id) ?? 0, [group.id])
  const bandKey = (band: Band) => `b:${group.id}:${band}`

  useFrame((_, dt) => {
    const ui = uiStore.get()
    let target = 0
    if (!ui.lab) {
      if (ui.planetId) target = ui.groupId ? (ui.groupId === group.id ? 1 : 0) : 1
      else if (ui.peekPlanetId === group.planetId) target = runtime.reveal
    }
    const d = stepDt(dt)
    presence.current.current = runtime.reducedMotion ? target : damp(presence.current.current, target, target > presence.current.current ? 2.6 : 5, d)
    const k = focus()
    ringFocus.current.current = presence.current.current * k
    ringOverview.current.current = presence.current.current * (1 - k)
    // band label anchors sit on the screen-right side of each ring (only meaningful for the focused group)
    const c = runtime.pos.get(centerKey)
    if (c && focused) {
      for (const b of layout.bands) {
        orbitPoint(anchor(bandKey(b.band)), b.inner, -runtime.cam.az, BAND_TILT[b.band])
        anchor(bandKey(b.band)).add(c)
      }
    }
  })
  useEffect(
    () => () => {
      BAND_ORDER.forEach((b) => forgetAnchor(bandKey(b)))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group.id, focused],
  )

  const pairs = useMemo(() => {
    const ids = new Set(shown.map((t) => t.id))
    const seen = new Set<string>()
    const out: [string, string][] = []
    for (const t of shown)
      for (const l of t.links) {
        if (!ids.has(l)) continue
        const k = [t.id, l].sort().join('|')
        if (seen.has(k)) continue
        seen.add(k)
        out.push([`t:${t.id}`, `t:${l}`])
      }
    return out
  }, [shown])

  return (
    <group>
      {layout.bands.map((b) => {
        const rings: number[] = []
        for (let r = b.inner; r <= b.outer + 0.01; r += 0.6) rings.push(r)
        return rings.map((r, i) => <BandRing key={`f${b.band}${i}`} radius={r} tilt={BAND_TILT[b.band]} center={centerKey} presence={ringFocus.current} />)
      })}
      {/* compact view: one faint ring per priority band, tinted with the group's colour */}
      {layout.bands.map((b) => (
        <BandRing key={`o${b.band}`} radius={overviewRadius((b.inner + b.outer) / 2)} tilt={BAND_TILT[b.band]} center={centerKey} presence={ringOverview.current} color={group.color} opacity={0.34} />
      ))}
      {shown.map((t) => {
        const slot = layout.slots.get(t.id)
        if (!slot) return null
        return <Satellite key={t.id} task={t} slot={slot} bandTilt={BAND_TILT[slot.band]} center={centerKey} quality={quality} mats={mats} presence={presence.current} focus={focus} />
      })}
      <LinkLinesGate pairs={pairs} presence={ringFocus.current} centerKey={centerKey} />
    </group>
  )
}

function LinkLinesGate({ pairs, presence, centerKey }: { pairs: [string, string][]; presence: { current: number }; centerKey: string }) {
  const level = useStore(uiStore, (s) => levelOf(s))
  return <LinkLines pairs={pairs} centerKey={centerKey} opacity={() => presence.current * (level === 'task' ? 0.9 : 0.75)} />
}
