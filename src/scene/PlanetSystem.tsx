import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Group, IcosahedronGeometry, LineLoop, Mesh, MeshStandardMaterial, Points, PointsMaterial, ShaderMaterial, Vector3 } from 'three'
import { layoutGroups, MOON_RADIUS, planetRadius, TAU, type MoonSlot } from '../domain/layout'
import { groupsOfPlanet, groupVisualKind, statsOf, tasksOfGroup, type Stats } from '../domain/stats'
import { urgencyOf } from '../domain/time'
import type { Group as GroupT, Planet, PlanetStyle, Task } from '../domain/types'
import { goGroup } from '../state/commands'
import { clockStore } from '../state/clock'
import { dataStore } from '../state/dataStore'
import { levelOf, uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { mix, shade } from './color'
import { Beacon } from './Effects'
import { sphereGeo } from './geometry'
import { clamp01, damp, dampAngle, hashString } from './math'
import { makeCtl, PlanetBody } from './PlanetBody'
import { usePickable } from './pick'
import { ProgressRing } from './ProgressRing'
import type { QualityProfile } from './quality'
import { anchor, forgetAnchor, runtime, stepDt } from './runtime'
import { orbitFragment, orbitVertex } from './shaders/misc'
import { SatelliteSystem, STATUS_COLOR } from './Satellites'
import { Station } from './Station'

const URGENCY_COLOR = ['#000000', '#ffd36b', '#ffa247', '#ff5a4a']
const MOON_TILT = [0.06, -0.1, 0.14, -0.05]

function moonStyle(group: GroupT): PlanetStyle {
  return {
    surface: 'rocky',
    colors: { primary: group.color, secondary: shade(group.color, 0.42), accent: mix(group.color, '#ffffff', 0.5) },
    detail: 0.7,
    turbulence: 0.75,
    coverage: 0.85,
    mix: { rock: 1, gas: 0, ocean: 0, tech: 0 },
    atmosphere: { kind: 'none', color: group.color, intensity: 0 },
    size: 1,
    seed: Math.floor(hashString(group.id) * 9999),
    tilt: 0.12,
  }
}

/* --------------------------------------------------------------- asteroid */

function Asteroid({ color, radius, ctl, seed }: { color: string; radius: number; ctl: { opacity: number }; seed: number }) {
  const geo = useMemo(() => {
    const g = new IcosahedronGeometry(1, 3)
    const p = g.getAttribute('position')
    const v = new Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
      const n = Math.sin(v.x * 3.1 + seed) * Math.cos(v.y * 2.7 + seed * 0.7) * Math.sin(v.z * 3.7 - seed * 0.3)
      const m = Math.sin(v.x * 7.3 + seed * 1.3) * Math.cos(v.z * 6.1 + seed) * 0.5
      v.normalize().multiplyScalar(0.82 + n * 0.22 + m * 0.07).multiply(new Vector3(1.15, 0.85, 1))
      p.setXYZ(i, v.x, v.y, v.z)
    }
    g.computeVertexNormals()
    return g
  }, [seed])
  const mat = useMemo(() => new MeshStandardMaterial({ color: shade(color, 0.7), roughness: 0.95, metalness: 0.05, flatShading: true, transparent: true }), [color])
  const ref = useRef<Mesh>(null)
  useEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  useFrame((_, dt) => {
    mat.opacity = ctl.opacity
    if (ref.current && !runtime.reducedMotion) {
      ref.current.rotation.y += dt * 0.25
      ref.current.rotation.x += dt * 0.12
    }
  })
  return <mesh ref={ref} geometry={geo} material={mat} scale={radius} />
}

/* ------------------------------------------------------------- mini-sats */

const DOT_COLOR_DONE = new Color('#9fe3c8')
const tmpColor = new Color()

/** Tiny lights circling a moon: a glanceable preview of its tasks while viewing the planet. */
function MiniSats({ tasks, centerKey, radiusFn, visibility, seed }: { tasks: Task[]; centerKey: string; radiusFn: () => number; visibility: () => number; seed: number }) {
  const MAX = 14
  const shown = useMemo(() => [...tasks].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done')).slice(0, MAX), [tasks])
  const geo = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX * 3), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(MAX * 3), 3))
    return g
  }, [])
  const mat = useMemo(() => new PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true }), [])
  const ref = useRef<Points>(null)
  const now = useStore(clockStore, (s) => s.now)
  useEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  useFrame(() => {
    const c = runtime.pos.get(centerKey)
    const pts = ref.current
    if (!c || !pts) return
    const vis = visibility()
    pts.visible = vis > 0.02 && shown.length > 0
    if (!pts.visible) return
    const pos = geo.getAttribute('position') as BufferAttribute
    const col = geo.getAttribute('color') as BufferAttribute
    const r = radiusFn()
    shown.forEach((t, i) => {
      const ring = i % 2
      const a = (i / shown.length) * TAU + runtime.tP * (0.5 + ring * 0.2) * (ring ? -1 : 1) + seed
      const rr = r * (1.0 + ring * 0.28)
      pos.setXYZ(i, c.x + Math.cos(a) * rr, c.y + Math.sin(a * 0.9) * rr * 0.2, c.z + Math.sin(a) * rr)
      const u = urgencyOf(t, now)
      if (u > 0) tmpColor.set(URGENCY_COLOR[u]!)
      else if (t.status === 'done') tmpColor.copy(DOT_COLOR_DONE).multiplyScalar(0.55)
      else tmpColor.set(STATUS_COLOR[t.status]).multiplyScalar(t.status === 'todo' ? 0.55 : 1)
      col.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b)
    })
    geo.setDrawRange(0, shown.length)
    pos.needsUpdate = true
    col.needsUpdate = true
    mat.opacity = vis
  })
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={3} />
}

/* ------------------------------------------------------------------ moon */

interface MoonProps {
  group: GroupT
  slot: MoonSlot
  stats: Stats
  tasks: Task[]
  planetKey: string
  quality: QualityProfile
  index: number
}

function MoonNode({ group, slot, stats, tasks, planetKey, quality, index }: MoonProps) {
  const root = useRef<Group>(null)
  const hit = useRef<Mesh>(null)
  const ctl = useMemo(() => makeCtl(), [])
  const key = `g:${group.id}`
  const slotRef = useRef(slot)
  slotRef.current = slot
  const statsRef = useRef(stats)
  statsRef.current = stats
  const st = useRef({ radius: slot.radius, angle: slot.phase, presence: 0, focus: 0, ready: false, born: 0 })
  const tilt = MOON_TILT[slot.lane % MOON_TILT.length]!
  const tmp = useMemo(() => new Vector3(), [])
  const style = useMemo(() => moonStyle(group), [group])
  const kind = groupVisualKind(group, stats)
  const R = MOON_RADIUS

  useEffect(() => () => forgetAnchor(key), [key])
  usePickable(hit, key)

  useFrame((_, dtRaw) => {
    const dt = stepDt(dtRaw)
    const g = root.current
    const center = runtime.pos.get(planetKey)
    if (!g || !center) return
    const o = st.current
    const sl = slotRef.current
    const ui = uiStore.get()
    const level = levelOf(ui)
    const inGroup = ui.groupId === group.id
    const peeking = !ui.planetId && ui.peekPlanetId === group.planetId
    const wants = !ui.lab && (level === 'planet' || inGroup || peeking)
    // while the planet is only being approached, the moons appear in step with the camera
    const target = wants ? (peeking ? runtime.reveal : 1) : 0
    o.presence = runtime.reducedMotion ? target : damp(o.presence, target, peeking ? 8 : wants ? 3 : 5, dt)
    o.focus = runtime.reducedMotion ? (inGroup ? 1 : 0) : damp(o.focus, inGroup ? 1 : 0, 3.2, dt)

    const tAngle = sl.phase + sl.omega * runtime.tP
    if (!o.ready) {
      o.angle = tAngle
      o.ready = true
    }
    o.angle = dampAngle(o.angle, tAngle, 5, dt)
    o.radius = damp(o.radius, sl.radius, 4, dt)
    const x = Math.cos(o.angle) * o.radius
    const z0 = Math.sin(o.angle) * o.radius
    tmp.set(x, -z0 * Math.sin(tilt), z0 * Math.cos(tilt)).add(center)
    g.position.copy(tmp)
    anchor(key).copy(tmp)
    const sc = 1 + o.focus * 0.95
    runtime.size.set(key, R * sc)
    // arrival: moons condense from the planet's glow
    if (!o.born) o.born = performance.now()
    const age = (performance.now() - o.born) / 1000
    const intro = runtime.reducedMotion ? 1 : clamp01((age - 0.15 * index) / 0.9)
    ctl.opacity = o.presence * intro
    ctl.light.copy(center).multiplyScalar(-1).normalize()
    g.scale.setScalar(Math.max(0.001, sc * (0.6 + 0.4 * intro)))
    g.visible = ctl.opacity > 0.004
    if (hit.current) hit.current.raycast = level === 'planet' && o.presence > 0.7 ? Mesh.prototype.raycast : () => {}
  })

  const hover = (on: boolean) => {
    if (!on) {
      runtime.hovering = false
      document.body.style.cursor = ''
      const h = uiStore.get().hover
      if (h?.kind === 'group' && h.id === group.id) uiStore.set({ hover: null })
      return
    }
    runtime.hovering = true
    document.body.style.cursor = 'pointer'
    uiStore.set({ hover: { kind: 'group', id: group.id } })
  }
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (runtime.dragMoved) return
    goGroup(group.id)
  }

  const urg = stats.urgency
  return (
    <group ref={root}>
      {kind === 'moon' && <PlanetBody style={style} radius={R} ctl={ctl} quality={quality} spin={0.12} />}
      {kind === 'asteroid' && <Asteroid color={group.color} radius={R * 0.95} ctl={ctl} seed={style.seed} />}
      {kind === 'station' && <Station color={group.color} radius={R * 1.15} ctl={ctl} seed={style.seed} />}
      <ProgressRing
        radius={R * 1.75}
        thickness={R * 0.04}
        progress={() => statsRef.current.progress}
        opacity={() => ctl.opacity * (stats.total ? 0.95 : 0.4)}
        color={mix(group.color, '#ffffff', 0.35)}
        trackAlpha={0.22}
        rotation={[Math.PI / 2 + 0.35, 0, 0.25]}
      />
      {urg > 0 && (
        <Beacon
          position={[R * 0.95, R * 0.8, 0.2]}
          size={R * 0.95}
          power={3.4}
          color={URGENCY_COLOR[urg]!}
          intensity={() => (0.5 + Math.min(1, stats.urgentCount * 0.2)) * (runtime.reducedMotion ? 0.85 : 0.65 + 0.35 * Math.sin(runtime.time * (urg === 3 ? 4 : 2.4))) * ctl.opacity}
        />
      )}
      <mesh ref={hit} geometry={sphereGeo(12)} scale={R * 1.9} onPointerOver={(e) => (e.stopPropagation(), hover(true))} onPointerOut={() => hover(false)} onClick={onClick}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <MiniSats tasks={tasks} centerKey={key} radiusFn={() => R * (1 + st.current.focus * 0.95) * 2.15} visibility={() => ctl.opacity * (1 - st.current.focus)} seed={style.seed} />
    </group>
  )
}

/* ------------------------------------------------------------ moon lanes */

function MoonLane({ radius, tilt, planetKey, presence }: { radius: number; tilt: number; planetKey: string; presence: { current: number } }) {
  const ref = useRef<LineLoop>(null)
  const geo = useMemo(() => {
    const pts: number[] = []
    const n = 180
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
        uniforms: { uColor: { value: new Color('#9db3d6') }, uOpacity: { value: 0.12 }, uTime: { value: 0 }, uDash: { value: 0 } },
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
    const c = runtime.pos.get(planetKey)
    const l = ref.current
    if (!c || !l) return
    l.position.copy(c)
    mat.uniforms.uOpacity!.value = 0.13 * presence.current
    l.visible = presence.current > 0.02
  })
  return <lineLoop ref={ref} geometry={geo} material={mat} rotation={[tilt, 0, 0]} frustumCulled={false} renderOrder={-6} />
}

/* ------------------------------------------------------------- the layer */

export function PlanetSystem({ quality }: { quality: QualityProfile }) {
  // the open planet, or the one whose moons are being revealed (zooming in) / hidden (zooming out)
  const planetId = useStore(uiStore, (s) => s.planetId ?? s.peekPlanetId)
  const planet = useStore(dataStore, (s) => s.data.planets.find((p) => p.id === planetId) ?? null)
  if (!planet) return null
  return <PlanetSystemInner key={planet.id} planet={planet} quality={quality} />
}

function PlanetSystemInner({ planet, quality }: { planet: Planet; quality: QualityProfile }) {
  const allGroups = useStore(dataStore, (s) => s.data.groups)
  const allTasks = useStore(dataStore, (s) => s.data.tasks)
  const now = useStore(clockStore, (s) => s.now)
  const groupId = useStore(uiStore, (s) => s.groupId)
  const lab = useStore(uiStore, (s) => s.lab !== null)
  const planetKey = `p:${planet.id}`
  const groups = useMemo(() => groupsOfPlanet(allGroups, planet.id), [allGroups, planet.id])
  const layout = useMemo(() => layoutGroups(groups, planetRadius(planet.style.size)), [groups, planet.style.size])
  const presence = useRef({ current: 0 })

  useFrame((_, dt) => {
    const ui = uiStore.get()
    // lanes follow the reveal while the planet is only being approached
    const target = lab ? 0 : ui.planetId ? 1 : ui.peekPlanetId === planet.id ? runtime.reveal : 0
    presence.current.current = runtime.reducedMotion ? target : damp(presence.current.current, target, 6, stepDt(dt))
  })

  const laneSet = useMemo(() => {
    const lanes = new Map<number, number>()
    for (const s of layout.slots.values()) lanes.set(s.lane, s.radius)
    return [...lanes.entries()]
  }, [layout])

  const perGroup = useMemo(() => {
    const m = new Map<string, { tasks: Task[]; stats: Stats }>()
    for (const g of groups) {
      const tasks = tasksOfGroup(allTasks, g.id)
      m.set(g.id, { tasks, stats: statsOf(tasks, now) })
    }
    return m
  }, [groups, allTasks, now])

  const focusGroup = groups.find((g) => g.id === groupId)
  const focusTasks = focusGroup ? perGroup.get(focusGroup.id)?.tasks ?? [] : []

  return (
    <group>
      {laneSet.map(([lane, radius]) => (
        <MoonLane key={lane} radius={radius} tilt={MOON_TILT[lane % MOON_TILT.length]!} planetKey={planetKey} presence={presence.current} />
      ))}
      {groups.map((g, i) => {
        const slot = layout.slots.get(g.id)
        const info = perGroup.get(g.id)
        if (!slot || !info) return null
        return <MoonNode key={g.id} group={g} slot={slot} stats={info.stats} tasks={info.tasks} planetKey={planetKey} quality={quality} index={i} />
      })}
      {focusGroup && <SatelliteSystem key={focusGroup.id} groupId={focusGroup.id} tasks={focusTasks} quality={quality} centerKey={`g:${focusGroup.id}`} />}
    </group>
  )
}
