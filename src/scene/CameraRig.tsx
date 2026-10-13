import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { groupsOfPlanet } from '../domain/stats'
import { layoutGroups, layoutTasks, planetRadius, universeExtent } from '../domain/layout'
import { dataStore } from '../state/dataStore'
import { levelOf, uiStore, type Level } from '../state/uiStore'
import { useStore } from '../state/store'
import { cameraControl } from './cameraControl'
import { clamp01, smoothDamp, type Smooth } from './math'
import { LAB_STAGE, runtime } from './runtime'

const BASE_FOV = 45

interface Goal {
  target: Vector3
  dist: number
  pol: number
  minDist: number
  maxDist: number
}

const sm = (): Smooth => ({ v: 0 })

export function CameraRig() {
  const { camera, gl, size } = useThree()
  const data = useStore(dataStore, (s) => s.data)
  const ui = useStore(uiStore, (s) => ({
    planetId: s.planetId,
    groupId: s.groupId,
    taskId: s.taskId,
    lab: s.lab !== null,
    labSize: s.lab?.draft.style.size ?? 1,
    forming: s.forming?.id ?? null,
    taskPanel: s.taskPanel !== null,
    navSeq: s.navSeq,
  }))

  /** framing numbers that depend on data, not on frames */
  const frame = useMemo(() => {
    const planet = data.planets.find((p) => p.id === ui.planetId)
    const universe = universeExtent(data.planets)
    const Rp = planetRadius(planet?.style.size ?? 1)
    const groups = planet ? groupsOfPlanet(data.groups, planet.id) : []
    const moonExtent = layoutGroups(groups, Rp).extent
    const satExtent = ui.groupId ? layoutTasks(data.tasks.filter((t) => t.groupId === ui.groupId)).extent : 5
    const labR = planetRadius(ui.labSize) * 1.55
    const formingPlanet = data.planets.find((p) => p.id === ui.forming)
    return { universe, Rp, moonExtent, satExtent, labR, formingR: planetRadius(formingPlanet?.style.size ?? 1) }
  }, [data.planets, data.groups, data.tasks, ui.planetId, ui.groupId, ui.forming, ui.labSize])

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
    pan: new Vector3(),
    lastNav: -1,
    lastInput: 0,
    level: 'universe' as Level | 'lab' | 'forming',
    ready: false,
  })
  const frameRef = useRef(frame)
  frameRef.current = frame
  const uiRef = useRef(ui)
  uiRef.current = ui

  const tmp = useRef({ goalTarget: new Vector3(), dir: new Vector3() })

  const levelGoal = (): Goal & { kind: Level | 'lab' | 'forming' } => {
    const f = frameRef.current
    const u = uiRef.current
    const live = (key: string) => runtime.pos.get(key)
    if (u.lab) return { kind: 'lab', target: LAB_STAGE.clone(), dist: f.labR * 3.9, pol: 1.28, minDist: f.labR * 2, maxDist: f.labR * 9 }
    if (u.forming) {
      const p = live(`p:${u.forming}`) ?? new Vector3()
      return { kind: 'forming', target: p, dist: f.formingR * 5.2 + 3, pol: 1.22, minDist: 4, maxDist: 60 }
    }
    const level = levelOf(u)
    if (level === 'universe') {
      const d = Math.max(54, (f.universe + 10) * 1.85 + 8)
      return { kind: level, target: new Vector3(), dist: d, pol: 0.98, minDist: 16, maxDist: d * 2.4 }
    }
    if (level === 'planet') {
      const d = Math.max(f.Rp * 4.4 + 4, f.moonExtent * 2.15 + 4)
      return { kind: level, target: live(`p:${u.planetId}`) ?? new Vector3(), dist: d, pol: 1.1, minDist: f.Rp * 1.8, maxDist: d * 2.4 }
    }
    if (level === 'group') {
      const d = Math.max(10, f.satExtent * 2.05 + 4)
      return { kind: level, target: live(`g:${u.groupId}`) ?? new Vector3(), dist: d, pol: 1.02, minDist: 3.5, maxDist: d * 2.2 }
    }
    return { kind: level, target: live(`t:${u.taskId}`) ?? new Vector3(), dist: 7.4, pol: 1.16, minDist: 3, maxDist: 20 }
  }

  useEffect(() => {
    const el = gl.domElement
    let drag: { x: number; y: number; pan: boolean; moved: boolean; id: number } | null = null
    const s = st.current

    const touch = () => (s.lastInput = performance.now())
    const goalLimits = () => levelGoal()

    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      runtime.dragMoved = false
      if (uiStore.get().mode === 'arrange' && runtime.hoverPlanet) return
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || e.ctrlKey, moved: false, id: e.pointerId }
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
      }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      touch()
      cameraControl.zoomBy(Math.exp(Math.max(-240, Math.min(240, e.deltaY * unit)) * 0.0011))
    }
    const ctx = (e: Event) => e.preventDefault()

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('contextmenu', ctx)

    cameraControl.rotateBy = (az, pol) => {
      s.gAz += az
      s.gPol = Math.min(1.5, Math.max(0.12, s.gPol + pol))
      touch()
    }
    cameraControl.zoomBy = (factor) => {
      const g = goalLimits()
      s.gDist = Math.min(g.maxDist, Math.max(g.minDist, s.gDist * factor))
      touch()
    }
    cameraControl.panBy = (dx, dy) => {
      const g = goalLimits()
      const k = (s.dist * 2 * Math.tan((s.fov * Math.PI) / 360)) / Math.max(1, runtime.height)
      const cx = Math.cos(s.az)
      const sx = Math.sin(s.az)
      // world follows the cursor: right = (cos, 0, -sin), ground-forward = (-sin, 0, -cos)
      s.pan.x += -dx * k * cx - dy * k * sx
      s.pan.z += dx * k * sx - dy * k * cx
      const lim = Math.max(30, g.maxDist * 0.7)
      if (s.pan.length() > lim) s.pan.setLength(lim)
      touch()
    }
    cameraControl.reset = () => {
      s.pan.set(0, 0, 0)
      const g = goalLimits()
      s.gDist = g.dist
      s.gPol = g.pol
      touch()
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
    }
  }, [gl])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const s = st.current
    const goal = levelGoal()
    const now = performance.now()

    // (re)frame whenever navigation changes: drop manual pan/zoom but keep the user's heading
    if (s.lastNav !== uiRef.current.navSeq || s.level !== goal.kind) {
      const first = !s.ready
      s.lastNav = uiRef.current.navSeq
      s.level = goal.kind
      s.pan.set(0, 0, 0)
      s.gDist = goal.dist
      s.gPol = goal.pol
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
    const flying = now < uiStore.get().flightUntil
    const smoothT = reduced ? 0.04 : flying ? 0.95 : 0.2

    // gentle drift while idle
    if (!reduced && now - s.lastInput > 6000 && (goal.kind === 'universe' || goal.kind === 'planet' || goal.kind === 'lab' || goal.kind === 'forming')) {
      s.gAz += dt * (goal.kind === 'universe' ? 0.012 : 0.02)
    }

    const goalTarget = tmp.current.goalTarget.copy(goal.target).add(s.pan)
    const lift = flying && !reduced ? Math.min(55, goalTarget.distanceTo(s.target) * 0.3) : 0

    s.target.x = smoothDamp(s.target.x, goalTarget.x, s.tv[0]!, smoothT, dt)
    s.target.y = smoothDamp(s.target.y, goalTarget.y, s.tv[1]!, smoothT, dt)
    s.target.z = smoothDamp(s.target.z, goalTarget.z, s.tv[2]!, smoothT, dt)
    s.dist = smoothDamp(s.dist, s.gDist + lift, s.distV, smoothT, dt)
    s.pol = smoothDamp(s.pol, s.gPol, s.polV, smoothT * 1.1, dt)
    s.az = smoothDamp(s.az, s.gAz, s.azV, flying ? smoothT : 0.16, dt)

    // cinematic: widen the lens slightly with travel speed
    const speed = Math.hypot(s.tv[0]!.v, s.tv[1]!.v, s.tv[2]!.v) + Math.abs(s.distV.v) * 0.5
    const goalFov = reduced ? BASE_FOV : BASE_FOV + clamp01(speed / 120) * 9
    s.fov = smoothDamp(s.fov, goalFov, s.fovV, 0.3, dt)

    const sp = Math.sin(s.pol)
    camera.position.set(s.target.x + s.dist * sp * Math.sin(s.az), s.target.y + s.dist * Math.cos(s.pol), s.target.z + s.dist * sp * Math.cos(s.az))
    camera.lookAt(s.target)

    // keep scene clear of side panels
    const u = uiRef.current
    const wide = size.width > 980
    const voGoal = !wide ? 0 : u.lab ? -runtime.panelLeft / 2 : u.taskPanel ? runtime.panelRight / 2 : 0
    s.vo = smoothDamp(s.vo, voGoal, s.voV, reduced ? 0.04 : 0.6, dt)

    const cam = camera as import('three').PerspectiveCamera
    cam.fov = s.fov
    cam.far = 4000
    cam.near = 0.1
    if (Math.abs(s.vo) > 0.5) cam.setViewOffset(size.width, size.height, s.vo, 0, size.width, size.height)
    else cam.clearViewOffset()
    cam.updateProjectionMatrix()

    runtime.cam.az = s.az
    runtime.cam.pol = s.pol
    runtime.cam.dist = s.dist
    runtime.cam.target.copy(s.target)
    runtime.cam.pos.copy(camera.position)
    runtime.camera = cam
    runtime.width = size.width
    runtime.height = size.height
  })

  return null
}
