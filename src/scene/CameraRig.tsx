import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { PerspectiveCamera, Vector2, Vector3 } from 'three'
import { groupsOfPlanet } from '../domain/stats'
import { planetReach, satelliteCap } from '../domain/overview'
import type { Group, Task } from '../domain/types'
import { laneHeight, laneOmega, laneRadius, layoutGroups, layoutTasks, planetRadius, universeExtent } from '../domain/layout'
import { enterPlanetByProximity, exitPlanetByProximity } from '../state/commands'
import { dataStore } from '../state/dataStore'
import { levelOf, uiStore, type Level } from '../state/uiStore'
import { useStore } from '../state/store'
import { cameraControl } from './cameraControl'
import { clamp01, smoothDamp, type Smooth } from './math'
import { pickAt, sharedRaycaster } from './pick'
import { intentCancel, intentStep, intentWheel, newIntent, proximityDistances, revealAmount } from './proximity'
import { LAB_STAGE, runtime, stepDt } from './runtime'
import { useQualityTier } from './useQuality'
import { focusWeightAfterZoom, pushOutOfSphere, rayPlaneHit, rayPointDistance, wheelFactor } from './zoom'

const BASE_FOV = 45
/** how long (s) the previous zoom target keeps priority when the cursor drifts off it */
const FOCUS_STICKY = 0.9

interface Goal {
  target: Vector3
  dist: number
  pol: number
  minDist: number
  maxDist: number
}
type Kind = Level | 'lab' | 'forming'

const sm = (): Smooth => ({ v: 0 })

/** default camera distance of a planet's own level: its moons and their satellites fill the view */
const planetDistance = (Rp: number, extent: number) => Math.max(Rp * 4.4 + 4, extent * 1.9 + 4)

/** radial room the moon lanes leave for the satellites shown around each group */
function reachOf(planetId: string | null, groups: Group[], tasks: Task[], tier: 'low' | 'medium' | 'high'): number {
  if (!planetId || groups.length === 0) return 0
  return planetReach(groups, tasks.filter((t) => t.planetId === planetId), satelliteCap(groups.length, tier))
}
const smoothstep = (x: number) => x * x * (3 - 2 * x)

export function CameraRig() {
  const { camera, gl, size } = useThree()
  const data = useStore(dataStore, (s) => s.data)
  const tier = useQualityTier()
  const tierRef = useRef(tier)
  tierRef.current = tier
  const ui = useStore(uiStore, (s) => ({
    planetId: s.planetId,
    groupId: s.groupId,
    taskId: s.taskId,
    lab: s.lab !== null,
    labSize: s.lab?.draft.style.size ?? 1,
    forming: s.forming?.id ?? null,
    taskPanel: s.taskPanel !== null,
    navSeq: s.navSeq,
    cameraKeep: s.cameraKeep,
    peekPlanetId: s.peekPlanetId,
    arrange: s.mode === 'arrange',
  }))

  /** framing numbers that depend on data, not on frames */
  const frame = useMemo(() => {
    const planet = data.planets.find((p) => p.id === ui.planetId)
    const universe = universeExtent(data.planets)
    const Rp = planetRadius(planet?.style.size ?? 1)
    const groups = planet ? groupsOfPlanet(data.groups, planet.id) : []
    const moonExtent = layoutGroups(groups, Rp, reachOf(planet?.id ?? null, groups, data.tasks, tier)).extent
    const satExtent = ui.groupId ? layoutTasks(data.tasks.filter((t) => t.groupId === ui.groupId)).extent : 5
    const labR = planetRadius(ui.labSize) * 1.55
    const formingPlanet = data.planets.find((p) => p.id === ui.forming)
    return { universe, Rp, moonExtent, satExtent, labR, formingR: planetRadius(formingPlanet?.style.size ?? 1) }
  }, [data.planets, data.groups, data.tasks, ui.planetId, ui.groupId, ui.forming, ui.labSize, tier])

  const st = useRef({
    target: new Vector3(),
    tv: [sm(), sm(), sm()],
    az: 0.55,
    azV: sm(),
    pol: 1.0,
    polV: sm(),
    dist: 80,
    distV: sm(),
    fov: BASE_FOV,
    fovV: sm(),
    vo: 0,
    voV: sm(),
    gAz: 0.55,
    gPol: 1.0,
    gDist: 80,
    /** manual offset (pan / cursor zoom) relative to the level's own target */
    pan: new Vector3(),
    /** zoom focus: blend of the goal target toward a (moving) object */
    focus: { key: null as string | null, w: 0 },
    /** the level's own target this frame, and the goal target actually used last frame */
    base: new Vector3(),
    baseKind: null as Kind | null,
    goalPrev: new Vector3(),
    panDecay: false,
    /** seconds of "cinematic flight" left, in simulation time (not wall time) */
    flightLeft: 0,
    clock: 0,
    lastWheelAt: -Infinity,
    lastNav: -1,
    lastInput: 0,
    level: 'universe' as Kind,
    ready: false,
    dragging: false,
    reveal: 0,
    avoid: new Vector3(),
    intent: newIntent(),
  })
  const frameRef = useRef(frame)
  frameRef.current = frame
  const uiRef = useRef(ui)
  uiRef.current = ui
  const dataRef = useRef(data)
  dataRef.current = data

  const tmp = useRef({
    goalTarget: new Vector3(),
    cam: new Vector3(),
    ghost: new PerspectiveCamera(),
    v: new Vector3(),
    ndc: new Vector2(),
  })

  /** world position of a planet computed from data (used before its 3D node has registered) */
  const planetFallback = (id: string | null): Vector3 | null => {
    const p = dataRef.current.planets.find((x) => x.id === id)
    if (!p) return null
    const a = p.phase + laneOmega(p.lane) * runtime.tU
    return new Vector3(Math.cos(a) * laneRadius(p.lane), laneHeight(p.lane), Math.sin(a) * laneRadius(p.lane))
  }

  /**
   * The level's own look-at target. Never falls back to the origin (the star): when a node
   * has not registered yet we use its parent, then the last known value.
   */
  const levelGoal = (): Goal & { kind: Kind } => {
    const f = frameRef.current
    const u = uiRef.current
    const s = st.current
    const live = (...keys: string[]) => {
      for (const k of keys) {
        const p = runtime.pos.get(k)
        if (p) return p
      }
      return null
    }
    const pick = (kind: Kind, fresh: Vector3 | null) => {
      const t = fresh ?? (s.baseKind === kind ? s.base : null) ?? planetFallback(u.planetId ?? u.forming) ?? new Vector3()
      return t
    }
    let g: Goal & { kind: Kind }
    if (u.lab) g = { kind: 'lab', target: LAB_STAGE, dist: f.labR * 3.9, pol: 1.28, minDist: f.labR * 2, maxDist: f.labR * 9 }
    else if (u.forming) g = { kind: 'forming', target: pick('forming', live(`p:${u.forming}`) ?? planetFallback(u.forming)), dist: f.formingR * 5.2 + 3, pol: 1.22, minDist: 4, maxDist: 60 }
    else {
      const level = levelOf(u)
      if (level === 'universe') {
        const d = Math.max(54, (f.universe + 10) * 1.85 + 8)
        g = { kind: level, target: new Vector3(), dist: d, pol: 0.98, minDist: 4, maxDist: d * 2.4 }
      } else if (level === 'planet') {
        const d = planetDistance(f.Rp, f.moonExtent)
        g = { kind: level, target: pick(level, live(`p:${u.planetId}`) ?? planetFallback(u.planetId)), dist: d, pol: 1.1, minDist: f.Rp * 1.8, maxDist: d * 2.4 }
      } else if (level === 'group') {
        const d = Math.max(10, f.satExtent * 2.05 + 4)
        g = { kind: level, target: pick(level, live(`g:${u.groupId}`, `p:${u.planetId}`)), dist: d, pol: 1.02, minDist: 3.5, maxDist: d * 2.2 }
      } else {
        g = { kind: level, target: pick(level, live(`t:${u.taskId}`, `g:${u.groupId}`, `p:${u.planetId}`)), dist: 7.4, pol: 1.16, minDist: 3, maxDist: 20 }
      }
    }
    s.base.copy(g.target)
    s.baseKind = g.kind
    g.target = s.base
    return g
  }

  /** Turn the focus blend into a plain offset so the goal target stays exactly where it is. */
  const bake = () => {
    const s = st.current
    if (!s.focus.key) return
    const fp = runtime.pos.get(s.focus.key)
    if (fp && s.focus.w > 0) {
      const base = s.base
      const t = tmp.current.v.copy(base).add(s.pan)
      t.addScaledVector(tmp.current.cam.subVectors(fp, t), s.focus.w)
      s.pan.copy(t).sub(base)
    }
    s.focus.key = null
    s.focus.w = 0
  }

  useEffect(() => {
    const el = gl.domElement
    let drag: { x: number; y: number; pan: boolean; moved: boolean; id: number } | null = null
    const s = st.current

    const touch = () => {
      s.lastInput = performance.now()
      s.panDecay = false
    }
    const goalLimits = () => levelGoal()
    const clampPan = (maxDist: number) => {
      const lim = Math.max(30, maxDist * 0.7)
      if (s.pan.length() > lim) s.pan.setLength(lim)
    }

    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      runtime.dragMoved = false
      if (uiStore.get().mode === 'arrange' && runtime.hoverPlanet) return
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || e.ctrlKey, moved: false, id: e.pointerId }
      s.dragging = true
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* pointer already released */
      }
    }
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < 4) return
      drag.moved = true
      runtime.dragMoved = true
      drag.x = e.clientX
      drag.y = e.clientY
      touch()
      if (drag.pan) cameraControl.panBy(dx, dy)
      else cameraControl.rotateBy(-dx * 0.0052, -dy * 0.0042)
    }
    const up = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) {
        try {
          el.releasePointerCapture(e.pointerId)
        } catch {
          /* already released */
        }
        drag = null
        s.dragging = false
      }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      cameraControl.wheel(e.clientX, e.clientY, e.deltaY, e.deltaMode)
    }
    const ctx = (e: Event) => e.preventDefault()

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('contextmenu', ctx)

    cameraControl.rotateBy = (az, pol) => {
      levelGoal()
      bake()
      intentCancel(s.intent)
      s.gAz += az
      s.gPol = Math.min(1.5, Math.max(0.12, s.gPol + pol))
      touch()
    }
    cameraControl.zoomBy = (factor) => {
      const g = goalLimits()
      intentCancel(s.intent)
      s.gDist = Math.min(g.maxDist, Math.max(g.minDist, s.gDist * factor))
      touch()
    }
    cameraControl.panBy = (dx, dy) => {
      const g = goalLimits()
      bake()
      intentCancel(s.intent)
      const k = (s.dist * 2 * Math.tan((s.fov * Math.PI) / 360)) / Math.max(1, runtime.height)
      const cx = Math.cos(s.az)
      const sx = Math.sin(s.az)
      // world follows the cursor: right = (cos, 0, -sin), ground-forward = (-sin, 0, -cos)
      s.pan.x += -dx * k * cx - dy * k * sx
      s.pan.z += dx * k * sx - dy * k * cx
      clampPan(g.maxDist)
      touch()
    }
    cameraControl.reset = () => {
      const g = goalLimits()
      s.pan.set(0, 0, 0)
      s.focus.key = null
      s.focus.w = 0
      s.gDist = g.dist
      s.gPol = g.pol
      intentCancel(s.intent)
      touch()
    }

    /** Wheel zoom aimed at whatever is under the cursor. */
    cameraControl.wheel = (clientX, clientY, deltaY, deltaMode) => {
      const f0 = wheelFactor(deltaY, deltaMode)
      const g = goalLimits()
      touch()
      const rect = el.getBoundingClientRect()
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1
      const ny = -((clientY - rect.top) / rect.height) * 2 + 1
      // lab, formation and single-task views zoom toward the centre: nothing to aim at there
      const aimable = g.kind === 'universe' || g.kind === 'planet' || g.kind === 'group'

      let key: string | null = null
      let hitRadius = 0
      if (aimable && Number.isFinite(nx) && Number.isFinite(ny)) {
        key = pickAt(nx, ny, camera)?.key ?? null
        // the previous target stays in charge while the cursor only drifts a little off it
        if (s.focus.key && key !== s.focus.key && s.clock - s.lastWheelAt < FOCUS_STICKY) {
          const fp = runtime.pos.get(s.focus.key)
          const R = runtime.size.get(s.focus.key)
          if (fp && R && rayPointDistance(sharedRaycaster.ray.origin, sharedRaycaster.ray.direction, fp) <= R * 3) key = s.focus.key
        }
        if (key) hitRadius = runtime.size.get(key) ?? 0
      }

      // never let the camera end up inside the object it is zooming into
      const minD = key ? Math.max(g.minDist, hitRadius * 2.3) : g.minDist
      const newDist = Math.min(g.maxDist, Math.max(minD, s.gDist * f0))
      const f = newDist / s.gDist

      if (Math.abs(f - 1) > 1e-6) {
        if (key) {
          if (key !== s.focus.key) {
            bake()
            s.focus.key = key
            s.focus.w = 0
          }
          s.focus.w = focusWeightAfterZoom(s.focus.w, f)
          if (s.focus.w <= 1e-4 && f > 1) {
            s.focus.key = null
            s.focus.w = 0
          }
        } else if (aimable) {
          bake()
          // aim from where the camera is *going*, so rapid wheel events stay consistent
          const T = tmp.current.goalTarget.copy(s.base).add(s.pan)
          const sp = Math.sin(s.gPol)
          const ghost = tmp.current.ghost
          ghost.position.set(T.x + s.gDist * sp * Math.sin(s.gAz), T.y + s.gDist * Math.cos(s.gPol), T.z + s.gDist * sp * Math.cos(s.gAz))
          ghost.lookAt(T)
          ghost.updateMatrixWorld(true)
          ghost.projectionMatrix.copy(camera.projectionMatrix)
          ghost.projectionMatrixInverse.copy(camera.projectionMatrixInverse)
          sharedRaycaster.setFromCamera(tmp.current.ndc.set(nx, ny), ghost)
          const P = rayPlaneHit(sharedRaycaster.ray.origin, sharedRaycaster.ray.direction, T.y, Math.max(60, s.gDist * 3), tmp.current.cam)
          if (P) {
            // keep the point under the cursor in place while the view scales around it
            s.pan.addScaledVector(P.sub(T), 1 - f)
            clampPan(g.maxDist)
          }
        }
        s.gDist = newDist
      }
      intentWheel(s.intent, key, f0)
      s.lastWheelAt = s.clock
    }

    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('contextmenu', ctx)
      cameraControl.rotateBy = () => {}
      cameraControl.zoomBy = () => {}
      cameraControl.panBy = () => {}
      cameraControl.reset = () => {}
      cameraControl.wheel = () => {}
    }
  // levelGoal only reads refs, so the handlers never go stale
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera])

  useFrame((_, dtRaw) => {
    const dt = stepDt(dtRaw)
    const s = st.current
    const goal = levelGoal()
    const u = uiRef.current
    s.clock += dt

    // (re)frame whenever navigation changes
    if (s.lastNav !== u.navSeq || s.level !== goal.kind) {
      const first = !s.ready
      const keep = u.cameraKeep && !first
      s.lastNav = u.navSeq
      s.level = goal.kind
      // cinematic flight is measured in simulation time so a slow machine cannot cut it short
      s.flightLeft = Math.max(0, (uiStore.get().flightUntil - performance.now()) / 1000)
      s.focus.key = null
      s.focus.w = 0
      intentCancel(s.intent)
      if (keep) {
        // continue from the current pose: only change what the camera orbits
        s.pan.copy(s.goalPrev).sub(goal.target)
        s.gDist = Math.min(goal.maxDist, Math.max(goal.minDist, s.gDist))
        s.panDecay = true
        uiStore.set({ cameraKeep: false })
      } else {
        s.pan.set(0, 0, 0)
        s.gDist = goal.dist
        s.gPol = goal.pol
        s.panDecay = false
        if (u.cameraKeep) uiStore.set({ cameraKeep: false })
      }
      if (first) {
        s.target.copy(goal.target)
        s.dist = goal.dist * 1.8
        s.pol = goal.pol - 0.25
        s.ready = true
      }
    }
    // keep manual zoom inside the level's limits when data changes the framing
    s.gDist = Math.min(goal.maxDist, Math.max(goal.minDist, s.gDist))

    const reduced = runtime.reducedMotion
    s.flightLeft = Math.max(0, s.flightLeft - dt)
    // 1 at the start of a flight, easing to 0 over its last 0.7 s: smoothing never switches abruptly
    const blend = reduced ? 0 : smoothstep(clamp01(s.flightLeft / 0.7))
    const smoothT = reduced ? 0.04 : 0.2 + (0.95 - 0.2) * blend

    // pan offsets left over from a proximity hand-over relax back to the level's centre
    if (s.panDecay) {
      s.pan.multiplyScalar(reduced ? 0 : Math.exp(-dt * 1.4))
      if (s.pan.lengthSq() < 1e-4) {
        s.pan.set(0, 0, 0)
        s.panDecay = false
      }
    }

    // gentle drift while idle
    if (!reduced && performance.now() - s.lastInput > 6000 && (goal.kind === 'universe' || goal.kind === 'planet' || goal.kind === 'lab' || goal.kind === 'forming')) {
      s.gAz += dt * (goal.kind === 'universe' ? 0.012 : 0.02)
    }

    const goalTarget = tmp.current.goalTarget.copy(goal.target).add(s.pan)
    if (s.focus.key) {
      const fp = runtime.pos.get(s.focus.key)
      if (fp) goalTarget.addScaledVector(tmp.current.cam.subVectors(fp, goalTarget), s.focus.w)
      else {
        s.focus.key = null
        s.focus.w = 0
      }
    }
    s.goalPrev.copy(goalTarget)
    runtime.zoomFocus.key = s.focus.key
    runtime.zoomFocus.w = s.focus.w
    const lift = Math.min(55, goalTarget.distanceTo(s.target) * 0.3) * blend

    s.target.x = smoothDamp(s.target.x, goalTarget.x, s.tv[0]!, smoothT, dt)
    s.target.y = smoothDamp(s.target.y, goalTarget.y, s.tv[1]!, smoothT, dt)
    s.target.z = smoothDamp(s.target.z, goalTarget.z, s.tv[2]!, smoothT, dt)
    s.dist = smoothDamp(s.dist, s.gDist + lift, s.distV, smoothT, dt)
    s.pol = smoothDamp(s.pol, s.gPol, s.polV, smoothT * 1.1, dt)
    s.az = smoothDamp(s.az, s.gAz, s.azV, 0.16 + (smoothT - 0.16) * blend, dt)

    // cinematic: widen the lens slightly with travel speed
    const speed = Math.hypot(s.tv[0]!.v, s.tv[1]!.v, s.tv[2]!.v) + Math.abs(s.distV.v) * 0.5
    const goalFov = reduced ? BASE_FOV : BASE_FOV + clamp01(speed / 120) * 9
    s.fov = smoothDamp(s.fov, goalFov, s.fovV, 0.3, dt)

    const sp = Math.sin(s.pol)
    const cam = tmp.current.cam.set(s.target.x + s.dist * sp * Math.sin(s.az), s.target.y + s.dist * Math.cos(s.pol), s.target.z + s.dist * sp * Math.cos(s.az))

    // soft collision: the camera glides around bodies instead of passing through them
    const desired = tmp.current.v.copy(cam)
    const spheres = collidersFor(goal.kind, u.planetId, u.groupId)
    for (let pass = 0; pass < 2; pass++) for (const [c, r] of spheres) pushOutOfSphere(desired, c, r)
    desired.sub(cam)
    if (desired.lengthSq() > s.avoid.lengthSq()) s.avoid.copy(desired)
    else s.avoid.lerp(desired, 1 - Math.exp(-dt * (reduced ? 40 : 7)))
    camera.position.copy(cam).add(s.avoid)
    camera.lookAt(s.target)

    // keep scene clear of side panels
    const wide = size.width > 980
    const voGoal = !wide ? 0 : u.lab ? -runtime.panelLeft / 2 : u.taskPanel ? runtime.panelRight / 2 : 0
    s.vo = smoothDamp(s.vo, voGoal, s.voV, reduced ? 0.04 : 0.6, dt)

    const pc = camera as PerspectiveCamera
    pc.fov = s.fov
    pc.far = 4000
    pc.near = 0.1
    if (Math.abs(s.vo) > 0.5) pc.setViewOffset(size.width, size.height, s.vo, 0, size.width, size.height)
    else pc.clearViewOffset()
    pc.updateProjectionMatrix()

    runtime.cam.az = s.az
    runtime.cam.pol = s.pol
    runtime.cam.dist = s.dist
    runtime.cam.target.copy(s.target)
    runtime.cam.pos.copy(camera.position)
    runtime.camera = pc
    runtime.width = size.width
    runtime.height = size.height

    proximityStep(dt, goal.kind)
  })

  /** bodies the camera must stay outside of, for the current level */
  const collidersFor = (kind: Kind, planetId: string | null, groupId: string | null): [Vector3, number][] => {
    const out: [Vector3, number][] = []
    if (kind === 'lab') return out
    const add = (key: string, k: number) => {
      const p = runtime.pos.get(key)
      const r = runtime.size.get(key)
      if (p && r) out.push([p, r * k])
    }
    if (kind === 'universe' || kind === 'forming') {
      out.push([ORIGIN, 4.2 * 1.3])
      for (const key of runtime.pos.keys()) if (key.startsWith('p:')) add(key, 1.3)
      return out
    }
    if (planetId) add(`p:${planetId}`, 1.3)
    for (const key of runtime.pos.keys()) {
      if (key.startsWith('g:')) add(key, 1.4)
      else if (key.startsWith('t:') && kind !== 'planet') add(key, 1.8)
    }
    void groupId
    return out
  }

  /** Detect zoom-to-open / zoom-to-leave intent and drive the progressive reveal of a planet's moons. */
  const proximityStep = (dt: number, kind: Kind) => {
    const s = st.current
    const u = uiRef.current
    const reduced = runtime.reducedMotion
    const busy = u.lab || !!u.forming || u.arrange || s.flightLeft > 0.15 || s.dragging

    let revealTarget = 1
    if (kind === 'universe') {
      revealTarget = 0
      const key = s.focus.key && s.focus.key.startsWith('p:') && s.focus.w > 0.1 ? s.focus.key : null
      const anchor = key ? runtime.pos.get(key) : null
      const R = key ? runtime.size.get(key) : null
      if (key && anchor && R) {
        const planetId = key.slice(2)
        const d = camera.position.distanceTo(anchor)
        const dists = proximityDistances(R, planetFraming(planetId))
        revealTarget = revealAmount(d, dists.enter, dists.revealStart)
        if (revealTarget > 0 && u.peekPlanetId !== planetId) uiStore.set({ peekPlanetId: planetId })
        const r = intentStep(s.intent, dt, { level: 'universe', busy, target: key, dist: d, enterDist: dists.enter, exitDist: dists.exit })
        if (r === 'enter') enterPlanetByProximity(planetId)
      } else {
        intentStep(s.intent, dt, { level: 'universe', busy, target: null, dist: Infinity, enterDist: 0, exitDist: 0 })
      }
    } else if (kind === 'planet' && u.planetId) {
      const anchor = runtime.pos.get(`p:${u.planetId}`)
      const R = runtime.size.get(`p:${u.planetId}`)
      if (anchor && R) {
        const d = camera.position.distanceTo(anchor)
        const dists = proximityDistances(R, planetFraming(u.planetId))
        const r = intentStep(s.intent, dt, { level: 'planet', busy, target: null, dist: d, enterDist: dists.enter, exitDist: dists.exit })
        if (r === 'exit') exitPlanetByProximity()
      }
    }
    s.reveal = reduced ? revealTarget : s.reveal + (revealTarget - s.reveal) * (1 - Math.exp(-dt * 6))
    runtime.reveal = s.reveal
    // once a revealed system has fully faded again, stop rendering it
    if (kind === 'universe' && revealTarget === 0 && s.reveal < 0.02 && u.peekPlanetId) uiStore.set({ peekPlanetId: null })
  }

  /** default camera distance of a planet's own level (used to size the entry/exit thresholds) */
  const planetFraming = (planetId: string) => {
    const d = dataRef.current
    const p = d.planets.find((x) => x.id === planetId)
    const Rp = planetRadius(p?.style.size ?? 1)
    const groups = groupsOfPlanet(d.groups, planetId)
    const extent = layoutGroups(groups, Rp, reachOf(planetId, groups, d.tasks, tierRef.current)).extent
    return planetDistance(Rp, extent)
  }

  return null
}

const ORIGIN = new Vector3()
