import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, Color, Group, LineLoop, Mesh, Plane, Raycaster, ShaderMaterial, Vector2, Vector3, BufferGeometry, Float32BufferAttribute } from 'three'
import { LANE_BASE, LANE_STEP, laneFromRadius, laneHeight, laneOmega, laneRadius, planetRadius, TAU } from '../domain/layout'
import { statsOf, tasksOfPlanet, type Stats } from '../domain/stats'
import { haloTarget, universeBudget, universeLod } from '../domain/overview'
import type { Planet } from '../domain/types'
import { movePlanet, goPlanet } from '../state/commands'
import { clockStore } from '../state/clock'
import { dataStore } from '../state/dataStore'
import { useStore } from '../state/store'
import { levelOf, uiStore } from '../state/uiStore'
import { Beacon } from './Effects'
import { sphereGeo } from './geometry'
import { clamp01, damp, dampAngle, easeOutBack, wrapPi } from './math'
import { PlanetBody, makeCtl } from './PlanetBody'
import { PlanetHalo } from './PlanetHalo'
import { useQualityTier } from './useQuality'
import { useViewportWidth } from './useViewport'
import { usePickable } from './pick'
import { ProgressRing } from './ProgressRing'
import { runtime, anchor, forgetAnchor, stepDt } from './runtime'
import type { QualityProfile } from './quality'
import { orbitFragment, orbitVertex } from './shaders/misc'

const URGENCY_COLOR = ['#000000', '#ffd36b', '#ffa247', '#ff5a4a']

/* ---------------------------------------------------------------- orbits */

function circle(radius: number, y: number, n = 220) {
  const pts: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU
    pts.push(Math.cos(a) * radius, y, Math.sin(a) * radius)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pts, 3))
  return g
}

function OrbitLane({ lane, active, showOrbits }: { lane: number; active: boolean; showOrbits: boolean }) {
  const geo = useMemo(() => circle(laneRadius(lane), laneHeight(lane)), [lane])
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: orbitVertex,
        fragmentShader: orbitFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uColor: { value: new Color('#8fa8cf') }, uOpacity: { value: 0.12 }, uTime: { value: 0 }, uDash: { value: 0 } },
      }),
    [],
  )
  const ref = useRef<LineLoop>(null)
  const op = useRef(0)
  useEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  useFrame((_, dt) => {
    const highlight = runtime.laneHighlight === lane
    const target = (active ? 1 : 0) * (highlight ? 0.55 : showOrbits ? 0.13 : 0.0)
    op.current = runtime.reducedMotion ? target : damp(op.current, target, 5, dt)
    mat.uniforms.uOpacity!.value = op.current
    mat.uniforms.uDash!.value = highlight ? 1 : 0
    mat.uniforms.uColor!.value.set(highlight ? '#ffd9a0' : '#8fa8cf')
    if (ref.current) ref.current.visible = op.current > 0.004
  })
  return <lineLoop ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={-10} />
}

/* ------------------------------------------------------------- the planets */

interface NodeProps {
  planet: Planet
  stats: Stats
  quality: QualityProfile
}

function PlanetNode({ planet, stats, quality }: NodeProps) {
  const root = useRef<Group>(null)
  const hit = useRef<Mesh>(null)
  const ctl = useMemo(() => makeCtl(), [])
  const orb = useRef({ radius: laneRadius(planet.lane), angle: planet.phase, presence: 0, dim: 1, ready: false })
  const statsRef = useRef(stats)
  statsRef.current = stats
  const R = planetRadius(planet.style.size)
  const key = `p:${planet.id}`
  const planetRef = useRef(planet)
  planetRef.current = planet

  useEffect(() => () => forgetAnchor(key), [key])
  usePickable(hit, key)

  useFrame((_, dtRaw) => {
    const dt = stepDt(dtRaw)
    const g = root.current
    if (!g) return
    const p = planetRef.current
    const o = orb.current
    const ui = uiStore.get()
    const level = levelOf(ui)
    const forming = ui.forming?.id === p.id
    const wantsVisible = !ui.lab && (level === 'universe' || ui.planetId === p.id)
    // while zooming into one planet its neighbours recede, so the approach reads as a focus
    const receding = level === 'universe' && ui.peekPlanetId !== null && ui.peekPlanetId !== p.id
    const target = wantsVisible ? (receding ? 1 - 0.65 * runtime.reveal : 1) : 0
    o.presence = runtime.reducedMotion ? target : damp(o.presence, target, wantsVisible ? 3.2 : 4.5, dt)

    // orbit
    const dragging = runtime.drag?.id === p.id
    const omega = laneOmega(p.lane)
    const tAngle = dragging ? runtime.drag!.angle : p.phase + omega * runtime.tU
    const tRadius = dragging ? runtime.drag!.radius : laneRadius(p.lane)
    if (!o.ready) {
      o.angle = tAngle
      o.radius = tRadius
      o.ready = true
    } else if (dragging) {
      o.angle = tAngle
      o.radius = tRadius
    } else {
      o.angle = dampAngle(o.angle, tAngle, 6, dt)
      o.radius = damp(o.radius, tRadius, 6, dt)
    }
    const y = dragging ? laneHeight(laneFromRadius(o.radius)) : laneHeight(p.lane)
    g.position.set(Math.cos(o.angle) * o.radius, y, Math.sin(o.angle) * o.radius)
    anchor(key).copy(g.position)
    runtime.size.set(key, R)

    // formation: the planet condenses out of the dust
    let scale = 1
    let vis = o.presence
    if (forming && ui.forming) {
      const age = (performance.now() - ui.forming.startedAt) / 1000
      scale = Math.max(0.001, easeOutBack(clamp01((age - 0.5) / 2.2)))
      vis = clamp01(age / 0.7) * Math.max(vis, 1)
    }
    ctl.opacity = clamp01(vis)
    ctl.light.copy(g.position).multiplyScalar(-1).normalize()
    // a faint sunlight floor so planets remain readable on the far side
    const deeper = level === 'group' || level === 'task'
    o.dim = runtime.reducedMotion ? (deeper ? 0.55 : 1) : damp(o.dim, deeper ? 0.55 : 1, 3, dt)
    ctl.dim = o.dim
    g.scale.setScalar(scale)
    g.visible = vis > 0.004
    if (hit.current) hit.current.raycast = vis > 0.6 && !forming ? Mesh.prototype.raycast : () => {}
  })

  const hover = (on: boolean) => {
    if (!on) {
      runtime.hovering = false
      runtime.hoverPlanet = null
      document.body.style.cursor = ''
      const h = uiStore.get().hover
      if (h?.kind === 'planet' && h.id === planet.id) uiStore.set({ hover: null })
      return
    }
    runtime.hovering = true
    runtime.hoverPlanet = planet.id
    document.body.style.cursor = uiStore.get().mode === 'arrange' ? 'grab' : 'pointer'
    uiStore.set({ hover: { kind: 'planet', id: planet.id } })
  }

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (runtime.dragMoved || uiStore.get().mode === 'arrange') return
    goPlanet(planet.id)
  }

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (uiStore.get().mode !== 'arrange') return
    e.stopPropagation()
    runtime.drag = { id: planet.id, radius: orb.current.radius, angle: orb.current.angle, lane: planet.lane }
    document.body.style.cursor = 'grabbing'
  }

  const urg = stats.urgency
  const ringRotation: [number, number, number] = [Math.PI / 2 + planet.style.tilt * 0.9 + 0.28, 0, planet.style.tilt * 0.6]
  const hasTasks = stats.total > 0

  return (
    <group ref={root}>
      <PlanetBody style={planet.style} radius={R} ctl={ctl} quality={quality} spin={0.04 + (planet.style.seed % 7) * 0.004} />
      <group rotation={ringRotation}>
        <ProgressRing
          radius={R * 1.62}
          thickness={R * 0.03}
          progress={() => statsRef.current.progress}
          opacity={() => ctl.opacity * (hasTasks ? 0.95 : 0.55)}
          color={stats.progress >= 1 ? '#9fe3c8' : '#e9c98d'}
          trackAlpha={0.14}
        />
      </group>
      {urg > 0 && (
        <Beacon
          position={[R * 1.15, R * 0.98, R * 0.35]}
          size={R * (0.5 + Math.min(stats.urgentCount, 5) * 0.07)}
          color={URGENCY_COLOR[urg]!}
          power={3.6}
          intensity={() => {
            const base = 0.55 + Math.min(1, stats.urgentCount * 0.18) * 0.7 + (urg === 3 ? 0.3 : 0)
            const rate = urg === 3 ? 4.2 : urg === 2 ? 2.6 : 1.4
            const pulse = runtime.reducedMotion ? 0.85 : 0.65 + 0.35 * Math.sin(runtime.time * rate)
            return base * pulse * ctl.opacity
          }}
        />
      )}
      <mesh
        ref={hit}
        geometry={sphereGeo(16)}
        scale={R * 1.5}
        onPointerOver={(e) => {
          e.stopPropagation()
          hover(true)
        }}
        onPointerOut={() => hover(false)}
        onClick={onClick}
        onPointerDown={onDown}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------- arrange-mode drag */

function DragController() {
  const { gl, camera } = useThree()
  useEffect(() => {
    const el = gl.domElement
    const ray = new Raycaster()
    const ndc = new Vector2()
    const hitPt = new Vector3()
    const move = (e: PointerEvent) => {
      const d = runtime.drag
      if (!d) return
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const plane = new Plane(new Vector3(0, 1, 0), -laneHeight(laneFromRadius(d.radius)))
      if (!ray.ray.intersectPlane(plane, hitPt)) return
      const radius = Math.max(LANE_BASE - LANE_STEP * 0.6, Math.hypot(hitPt.x, hitPt.z))
      d.radius = radius
      d.angle = Math.atan2(hitPt.z, hitPt.x)
      d.lane = laneFromRadius(radius)
      runtime.laneHighlight = d.lane
    }
    const up = () => {
      const d = runtime.drag
      if (!d) return
      runtime.drag = null
      runtime.laneHighlight = null
      document.body.style.cursor = runtime.hoverPlanet ? 'grab' : ''
      const lane = laneFromRadius(d.radius)
      const phase = wrapPi(d.angle - laneOmega(lane) * runtime.tU)
      movePlanet(d.id, lane, phase)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [gl, camera])
  return null
}

/* ------------------------------------------------------------ the layer */

export function Universe({ quality }: { quality: QualityProfile }) {
  const planets = useStore(dataStore, (s) => s.data.planets)
  const tasks = useStore(dataStore, (s) => s.data.tasks)
  const settings = useStore(dataStore, (s) => s.data.settings)
  const now = useStore(clockStore, (s) => s.now)
  const mode = useStore(uiStore, (s) => s.mode)

  const stats = useMemo(() => {
    const m = new Map<string, Stats>()
    for (const p of planets) m.set(p.id, statsOf(tasksOfPlanet(tasks, p.id), now))
    return m
  }, [planets, tasks, now])

  const lanes = useMemo(() => {
    const set = new Set(planets.map((p) => p.lane))
    const max = planets.reduce((m, p) => Math.max(m, p.lane), -1)
    // always show one spare lane so the structure of the system is legible
    for (let l = 0; l <= Math.min(max + 1, 40); l++) if (planets.length > 0 || l === 0) set.add(l)
    return [...set].sort((a, b) => a - b)
  }, [planets])

  return (
    <group>
      {lanes.map((l) => (
        <OrbitLaneGate key={l} lane={l} showOrbits={settings.showOrbits || mode === 'arrange'} />
      ))}
      {planets.map((p) => (
        <PlanetNode key={p.id} planet={p} stats={stats.get(p.id)!} quality={quality} />
      ))}
      <DragController />
      <UniverseDirector />
      <HaloLayer />
    </group>
  )
}

/* ------------------------------------------------- orbits, moons and summary */

/**
 * Decides, every frame, how much each planet shows from the universe. Level of detail follows the
 * planet's size on screen (so it adapts to zoom, window size and distance); a budget that depends on
 * the graphics profile and the screen width caps how many planets draw orbits and moons at once.
 * Hovered or zoomed-on planets always qualify and also get the task summary. Values are damped, so
 * everything fades in quickly and lingers when the cursor leaves.
 */
function UniverseDirector() {
  const tier = useQualityTier()
  const width = useViewportWidth()
  const budget = universeBudget(tier, width)
  const haloLimit = tier === 'low' ? 1 : 2
  useFrame((_, dtRaw) => {
    const cam = runtime.camera
    const ui = uiStore.get()
    const data = dataStore.get().data
    const active = !ui.lab && levelOf(ui) === 'universe' && ui.mode !== 'arrange' && !runtime.drag
    const dt = stepDt(dtRaw)
    const tanHalf = cam ? Math.tan((cam.fov * Math.PI) / 360) : 1
    const withGroups = new Set(data.groups.map((g) => g.planetId))
    const rows: { id: string; lod: number; halo: number; forced: boolean; px: number }[] = []
    for (const p of data.planets) {
      const c = runtime.pos.get(`p:${p.id}`)
      let lod = 0
      let halo = 0
      let forced = false
      let px = 0
      if (cam && c) {
        px = ((runtime.size.get(`p:${p.id}`) ?? 1) * (runtime.height / 2)) / (cam.position.distanceTo(c) * tanHalf)
        const hovered = active && runtime.hoverPlanet === p.id
        const zoomFocus = active && runtime.zoomFocus.key === `p:${p.id}` && runtime.zoomFocus.w > 0.5
        forced = hovered || zoomFocus
        if (withGroups.has(p.id)) lod = universeLod({ pxRadius: px, hovered, zoomFocus })
        halo = haloTarget({ hovered, zoomFocus })
        // once the real moons take over the summary steps aside
        if (ui.peekPlanetId === p.id) halo *= 1 - clamp01(runtime.reveal * 2.2)
      }
      rows.push({ id: p.id, lod: active ? lod : 0, halo: active ? halo : 0, forced, px })
    }
    // the budget goes to the planets that are being pointed at, then to the biggest on screen
    rows.sort((a, b) => Number(b.forced) - Number(a.forced) || b.px - a.px)
    const systems: string[] = []
    const prevNamed = ui.haloLabelPlanets
    const named: string[] = []
    const halos: string[] = []
    let haloCount = 0
    rows.forEach((r, i) => {
      const lodGoal = i < budget.systems ? r.lod : 0
      const curLod = runtime.lod.get(r.id) ?? 0
      const nextLod = runtime.reducedMotion ? lodGoal : damp(curLod, lodGoal, lodGoal > curLod ? 6 : 3, dt)
      if (nextLod > 0.01) {
        runtime.lod.set(r.id, nextLod)
        systems.push(r.id)
      } else runtime.lod.delete(r.id)

      const haloGoal = haloCount < haloLimit ? r.halo : 0
      if (r.halo > 0) haloCount++
      const cur = runtime.halo.get(r.id) ?? 0
      const next = runtime.reducedMotion ? haloGoal : damp(cur, haloGoal, haloGoal > cur ? 9 : 2.4, dt)
      if (next > 0.004) {
        runtime.halo.set(r.id, next)
        halos.push(r.id)
        // names are written for the full summary, with a little hysteresis while it fades
        if (haloGoal >= 0.99 || (prevNamed.includes(r.id) && next > 0.5)) named.push(r.id)
      } else runtime.halo.delete(r.id)
    })
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
    const patch: Partial<typeof ui> = {}
    if (!same(ui.systemPlanets, systems)) patch.systemPlanets = systems
    if (!same(ui.haloPlanets, halos)) patch.haloPlanets = halos
    if (!same(prevNamed, named)) patch.haloLabelPlanets = named
    if (Object.keys(patch).length) uiStore.set(patch)
  })
  return null
}

function HaloLayer() {
  const ids = useStore(uiStore, (s) => s.haloPlanets)
  const planets = useStore(dataStore, (s) => s.data.planets)
  const groups = useStore(dataStore, (s) => s.data.groups)
  const tasks = useStore(dataStore, (s) => s.data.tasks)
  return (
    <>
      {ids.map((id) => {
        const planet = planets.find((p) => p.id === id)
        if (!planet) return null
        return <PlanetHalo key={id} planet={planet} allGroups={groups} allTasks={tasks} />
      })}
    </>
  )
}

/** reads presence from the store each frame so lanes fade without React re-renders */
function OrbitLaneGate({ lane, showOrbits }: { lane: number; showOrbits: boolean }) {
  const active = useStore(uiStore, (s) => !s.lab && levelOf(s) === 'universe')
  return <OrbitLane lane={lane} active={active} showOrbits={showOrbits} />
}
