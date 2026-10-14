import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Group, IcosahedronGeometry, LineLoop, Mesh, MeshStandardMaterial, Points, PointsMaterial, ShaderMaterial, Vector3 } from 'three'
import { layoutGroups, MOON_RADIUS, planetRadius, TAU, type MoonSlot } from '../domain/layout'
import { groupReach, moonWeight, planetReach, rankGroups, rankTasks, satelliteCap, UNIVERSE_MOON_SCALE, universeBudget, universeRadius } from '../domain/overview'
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
import { useQualityTier } from './useQuality'
import { useViewportWidth } from './useViewport'
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
  /** tasks of the group that do not fit as individual satellites: shown as a faint dust of lights */
  overflow: Task[]
  /** radius of the outermost compact satellite orbit */
  reach: number
  planetKey: string
  quality: QualityProfile
  index: number
  /** importance rank among the planet's groups (decides which moons survive when space is short) */
  rank: number
  /** shared per-planet state: how open the system is and how much of it the universe view allows */
  sys: SystemState
  planetR: number
  maxMoons: number
}

/** Per-planet values written once a frame by the system and read by its moons and lanes. */
interface SystemState {
  /** 0 = compact, as seen from the universe; 1 = the planet's own view */
  open: number
  /** moons' visibility from the universe (level of detail) */
  lod: number
  /** weight each moon currently has (lets lanes follow their moons) */
  moonW: Map<string, number>
}

function MoonNode({ group, slot, stats, overflow, reach, planetKey, quality, index, rank, sys, planetR, maxMoons }: MoonProps) {
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

  useEffect(
    () => () => {
      forgetAnchor(key)
      runtime.moonFocus.delete(group.id)
      runtime.moonOrbit.delete(group.id)
      sys.moonW.delete(group.id)
    },
    [key, group.id, sys],
  )
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
    const mine = ui.planetId === group.planetId
    const peeking = !ui.planetId && ui.peekPlanetId === group.planetId
    // seen from the universe the moon is as present as its rank and the level of detail allow;
    // inside its planet every moon is shown, and inside a group only that one
    let target = 0
    if (!ui.lab) {
      if (mine) target = level === 'planet' || inGroup ? 1 : 0
      else if (!ui.planetId) target = Math.max(moonWeight(sys.lod, rank, maxMoons), peeking ? runtime.reveal : 0)
    }
    sys.moonW.set(group.id, target)
    o.presence = runtime.reducedMotion ? target : damp(o.presence, target, peeking ? 8 : target > o.presence ? 3 : 5, dt)
    o.focus = runtime.reducedMotion ? (inGroup ? 1 : 0) : damp(o.focus, inGroup ? 1 : 0, 3.2, dt)
    runtime.moonFocus.set(group.id, o.focus)

    const tAngle = sl.phase + sl.omega * runtime.tP
    if (!o.ready) {
      o.angle = tAngle
      o.ready = true
    }
    o.angle = dampAngle(o.angle, tAngle, 5, dt)
    // the orbit opens from its compact universe size to the planet view as the camera comes in
    const wantR = universeRadius(planetR, sl.lane) + (sl.radius - universeRadius(planetR, sl.lane)) * sys.open
    o.radius = damp(o.radius, wantR, 4, dt)
    const x = Math.cos(o.angle) * o.radius
    const z0 = Math.sin(o.angle) * o.radius
    tmp.set(x, -z0 * Math.sin(tilt), z0 * Math.cos(tilt)).add(center)
    g.position.copy(tmp)
    anchor(key).copy(tmp)
    const sc = (UNIVERSE_MOON_SCALE + (1 - UNIVERSE_MOON_SCALE) * sys.open) * (1 + o.focus * 0.95)
    runtime.size.set(key, R * sc)
    runtime.moonOrbit.set(group.id, { angle: o.angle, radius: o.radius, tilt, presence: o.presence })
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
      <MiniSats tasks={overflow} centerKey={key} radiusFn={() => Math.max(reach, R * 2.6) + 0.35} visibility={() => ctl.opacity * (1 - st.current.focus) * sys.open} seed={style.seed} />
    </group>
  )
}

/* ------------------------------------------------------------ moon lanes */

function MoonLane({ lane, radius, tilt, planetKey, members, sys, planetR }: { lane: number; radius: number; tilt: number; planetKey: string; members: string[]; sys: SystemState; planetR: number }) {
  const ref = useRef<LineLoop>(null)
  const op = useRef(0)
  const geo = useMemo(() => {
    const pts: number[] = []
    const n = 180
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU
      pts.push(Math.cos(a), 0, Math.sin(a))
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts, 3))
    return g
  }, [])
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
  useFrame((_, dt) => {
    const c = runtime.pos.get(planetKey)
    const l = ref.current
    if (!c || !l) return
    // an orbit is drawn as long as one of its moons is
    let w = 0
    for (const id of members) w = Math.max(w, sys.moonW.get(id) ?? 0)
    op.current = runtime.reducedMotion ? w : damp(op.current, w, 5, stepDt(dt))
    const r = universeRadius(planetR, lane) + (radius - universeRadius(planetR, lane)) * sys.open
    l.position.copy(c)
    l.scale.setScalar(r)
    mat.uniforms.uOpacity!.value = 0.13 * op.current
    l.visible = op.current > 0.02
  })
  return <lineLoop ref={ref} geometry={geo} material={mat} rotation={[tilt, 0, 0]} frustumCulled={false} renderOrder={-6} />
}

/* ------------------------------------------------------------- the layer */

/**
 * Orbits and moons of every planet that is big enough on screen (a budgeted few), plus the open one.
 * The universe director decides who qualifies; the planet being approached or open always does.
 */
export function PlanetSystem({ quality }: { quality: QualityProfile }) {
  const planets = useStore(dataStore, (s) => s.data.planets)
  const listed = useStore(uiStore, (s) => s.systemPlanets)
  const openId = useStore(uiStore, (s) => s.planetId)
  const peekId = useStore(uiStore, (s) => s.peekPlanetId)
  const ids = new Set(listed)
  if (openId) ids.add(openId)
  if (peekId) ids.add(peekId)
  return (
    <>
      {planets
        .filter((p) => ids.has(p.id))
        .map((p) => (
          <PlanetSystemInner key={p.id} planet={p} quality={quality} />
        ))}
    </>
  )
}

function PlanetSystemInner({ planet, quality }: { planet: Planet; quality: QualityProfile }) {
  const allGroups = useStore(dataStore, (s) => s.data.groups)
  const allTasks = useStore(dataStore, (s) => s.data.tasks)
  const now = useStore(clockStore, (s) => s.now)
  const tier = useQualityTier()
  const width = useViewportWidth()
  // only the open planet (or the one being approached) draws tasks; the others show orbits and moons
  const focusedNow = useStore(uiStore, (s) => s.planetId === planet.id || s.peekPlanetId === planet.id)
  // leaving a planet: its extra moons and tasks stay mounted until the orbits have closed again
  const [hold, setHold] = useState(focusedNow)
  const focused = focusedNow || hold
  const planetKey = `p:${planet.id}`
  const Rp = planetRadius(planet.style.size)
  const groups = useMemo(() => groupsOfPlanet(allGroups, planet.id), [allGroups, planet.id])
  const planetTasks = useMemo(() => allTasks.filter((t) => t.planetId === planet.id), [allTasks, planet.id])
  // each group may draw only so many satellites; the lanes of moons leave room for them
  const cap = satelliteCap(groups.length, tier)
  const reach = useMemo(() => planetReach(groups, planetTasks, cap), [groups, planetTasks, cap])
  const layout = useMemo(() => layoutGroups(groups, Rp, reach), [groups, Rp, reach])
  const { moons: maxMoons } = universeBudget(tier, width)
  const ranked = useMemo(() => rankGroups(groups, planetTasks, now), [groups, planetTasks, now])
  const rankOf = useMemo(() => new Map(ranked.map((g, i) => [g.id, i])), [ranked])
  const sys = useMemo<SystemState>(() => ({ open: 0, lod: 0, moonW: new Map() }), [])

  useFrame((_, dt) => {
    const ui = uiStore.get()
    const open = ui.lab ? 0 : ui.planetId === planet.id ? 1 : ui.peekPlanetId === planet.id && !ui.planetId ? runtime.reveal : 0
    sys.open = runtime.reducedMotion ? open : damp(sys.open, open, open > sys.open ? 6 : 4, stepDt(dt))
    sys.lod = runtime.lod.get(planet.id) ?? 0
    if (focusedNow && !hold) setHold(true)
    else if (!focusedNow && hold && sys.open < 0.03) setHold(false)
  })

  // from the universe only the most important moons are mounted; the planet view mounts them all
  const shown = focused ? groups : ranked.slice(0, maxMoons)
  const shownIds = useMemo(() => new Set(shown.map((g) => g.id)), [shown])
  const lanes = useMemo(() => {
    const m = new Map<number, { radius: number; members: string[] }>()
    for (const g of shown) {
      const sl = layout.slots.get(g.id)
      if (!sl) continue
      const e = m.get(sl.lane) ?? { radius: sl.radius, members: [] }
      e.members.push(g.id)
      m.set(sl.lane, e)
    }
    return [...m.entries()]
  }, [shown, layout])

  const perGroup = useMemo(() => {
    const m = new Map<string, { tasks: Task[]; stats: Stats; overflow: Task[]; reach: number }>()
    for (const g of groups) {
      const tasks = tasksOfGroup(allTasks, g.id)
      const rk = rankTasks(tasks, now)
      m.set(g.id, { tasks, stats: statsOf(tasks, now), overflow: rk.slice(cap, cap + 14), reach: groupReach(rk.slice(0, cap)) })
    }
    return m
  }, [groups, allTasks, now, cap])

  return (
    <group>
      {lanes.map(([lane, e]) => (
        <MoonLane key={lane} lane={lane} radius={e.radius} tilt={MOON_TILT[lane % MOON_TILT.length]!} planetKey={planetKey} members={e.members} sys={sys} planetR={Rp} />
      ))}
      {groups.map((g, i) => {
        const slot = layout.slots.get(g.id)
        const info = perGroup.get(g.id)
        if (!slot || !info || !shownIds.has(g.id)) return null
        return (
          <MoonNode
            key={g.id}
            group={g}
            slot={slot}
            stats={info.stats}
            overflow={info.overflow}
            reach={info.reach}
            planetKey={planetKey}
            quality={quality}
            index={i}
            rank={rankOf.get(g.id) ?? i}
            sys={sys}
            planetR={Rp}
            maxMoons={maxMoons}
          />
        )
      })}
      {/* every group shows its own tasks at once; focusing a group only opens them up */}
      {focused &&
        groups.map((g) => {
          const info = perGroup.get(g.id)
          if (!info || info.tasks.length === 0) return null
          return <SatelliteSystem key={g.id} group={g} tasks={info.tasks} quality={quality} centerKey={`g:${g.id}`} cap={cap} />
        })}
    </group>
  )
}
