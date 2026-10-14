import { Vector3, type PerspectiveCamera } from 'three'

/**
 * Mutable, per-frame state shared between the 3D scene, the camera rig and the
 * DOM overlays (labels, radar). Never put it in React state: it changes 60×/s.
 */
export interface OrbitView {
  radius: number
  angle: number
  ready: boolean
}

/** The formation chamber lives far from the star so the lab never overlaps the universe. */
export const LAB_STAGE = new Vector3(150, 6, -120)

export const runtime = {
  /** wall clock (s) – shader time */
  time: 0,
  /** orbit clocks (already multiplied by user speed and smoothed) */
  tU: 0,
  tP: 0,
  /** satellites: runs while a planet or one of its groups is open */
  tS: 0,
  /** smoothed speed factors 0..1 */
  fU: 1,
  fP: 1,
  fS: 1,
  reducedMotion: false,
  camera: null as PerspectiveCamera | null,
  width: 1,
  height: 1,
  /** camera rig state exposed for the radar / labels */
  cam: { az: 0, pol: 1, dist: 50, target: new Vector3(), pos: new Vector3() },
  /** world positions of interactive anchors: 'p:<id>', 'g:<id>', 't:<id>' … */
  pos: new Map<string, Vector3>(),
  /** visual radius of an anchor (world units) for label offsets */
  size: new Map<string, number>(),
  /** planet currently being dragged in arrange mode */
  drag: null as null | { id: string; radius: number; angle: number; lane: number },
  /** true while the pointer is over a pickable object */
  hovering: false,
  /** planet under the pointer (used to disable camera drag while rearranging) */
  hoverPlanet: null as string | null,
  /** lane highlighted while dragging a planet */
  laneHighlight: null as number | null,
  /** set by the camera rig when the user dragged the view (suppresses click) */
  dragMoved: false,
  /** side panel occupying part of the viewport (px) so the scene can be re-centred */
  panelLeft: 0,
  panelRight: 0,
  fps: 60,
  /** test hook: when set, every rendered frame advances the simulation by exactly this many seconds */
  fixedDt: null as number | null,
  /** hit meshes the camera rig may aim at (planets, moons, satellites): key → mesh */
  pickables: new Map<string, import('three').Object3D>(),
  /** 0..1 how much of the focused planet's orbital system is revealed while approaching it */
  reveal: 0,
  /** current zoom focus (object the camera is converging on) — also read by the e2e checks */
  zoomFocus: { key: null as string | null, w: 0 },
  /** 0 = moon seen from the planet, 1 = moon focused: lets its satellites follow the zoom */
  moonFocus: new Map<string, number>(),
  /** planetId → 0..1 level of detail of the summary halo seen from the universe */
  halo: new Map<string, number>(),
  /** planetId → 0..1 level of detail of its orbits and moons seen from the universe */
  lod: new Map<string, number>(),
  /** groupId → where its moon is on its orbit (lets the task summary follow the moon) */
  moonOrbit: new Map<string, { angle: number; radius: number; tilt: number; presence: number }>(),
}

/** Simulation step for a frame: clamped wall time, or the fixed test step. */
export const stepDt = (raw: number) => runtime.fixedDt ?? Math.min(raw, 0.1)

export function anchor(key: string): Vector3 {
  let v = runtime.pos.get(key)
  if (!v) {
    v = new Vector3()
    runtime.pos.set(key, v)
  }
  return v
}

export function forgetAnchor(key: string) {
  runtime.pos.delete(key)
  runtime.size.delete(key)
}
