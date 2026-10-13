/**
 * Intent detection for "zoom into a planet to open it" / "zoom out to leave it".
 *
 * Opening a category must never be an accident of moving the camera, so entering needs
 * ALL of: a valid target planet (the one under the cursor during the wheel gesture),
 * enough accumulated zoom-in on that same target, proximity relative to the planet's
 * real size, a still-active gesture, and proximity held for a short dwell.
 * Leaving uses a clearly larger distance (hysteresis) plus an explicit zoom-out gesture.
 */

export interface ProximityParams {
  /** accumulated ln(zoom) needed on the same target (≈ 4 wheel notches) */
  minIntent: number
  /** a wheel event must have happened within this many seconds */
  gesture: number
  /** proximity must hold this long (s) before triggering */
  dwell: number
  /** idle time after which accumulated intent is forgotten */
  forget: number
}

export const PROXIMITY: ProximityParams = { minIntent: 0.4, gesture: 0.6, dwell: 0.16, forget: 1.4 }

export interface IntentState {
  key: string | null
  zoomIn: number
  zoomOut: number
  lastWheel: number
  held: number
  clock: number
}

export const newIntent = (): IntentState => ({ key: null, zoomIn: 0, zoomOut: 0, lastWheel: -Infinity, held: 0, clock: 0 })

/** Register a wheel step (`factor` < 1 zooms in) aimed at `key` (null = empty space). */
export function intentWheel(s: IntentState, key: string | null, factor: number, p = PROXIMITY): void {
  if (s.clock - s.lastWheel > p.forget) {
    s.zoomIn = 0
    s.zoomOut = 0
    s.held = 0
  }
  // entering needs the SAME target all along; leaving only needs a sustained zoom-out
  if (key !== s.key) {
    s.key = key
    s.zoomIn = 0
  }
  const g = -Math.log(factor)
  if (g > 0) {
    s.zoomIn += g
    s.zoomOut = 0
  } else {
    s.zoomOut += -g
    s.zoomIn = 0
  }
  s.lastWheel = s.clock
}

/** Any non-wheel camera action (drag, pan, keyboard, recentre) cancels the intent. */
export function intentCancel(s: IntentState): void {
  s.key = null
  s.zoomIn = 0
  s.zoomOut = 0
  s.held = 0
  s.lastWheel = -Infinity
}

export interface IntentContext {
  level: 'universe' | 'planet' | 'other'
  /** something else owns the camera (flight, lab, arranging, dragging …) */
  busy: boolean
  /** planet key under the gesture ('p:<id>') — required for entering */
  target: string | null
  /** camera ↔ planet distance */
  dist: number
  enterDist: number
  exitDist: number
}

export type IntentResult = 'enter' | 'exit' | 'none'

export function intentStep(s: IntentState, dt: number, c: IntentContext, p = PROXIMITY): IntentResult {
  s.clock += dt
  if (s.clock - s.lastWheel > p.forget) {
    s.zoomIn = 0
    s.zoomOut = 0
  }
  const active = s.clock - s.lastWheel <= p.gesture
  let wants = false
  if (!c.busy && active) {
    if (c.level === 'universe') wants = c.target !== null && s.key === c.target && s.zoomIn >= p.minIntent && c.dist <= c.enterDist
    else if (c.level === 'planet') wants = s.zoomOut >= p.minIntent && c.dist >= c.exitDist
  }
  s.held = wants ? s.held + dt : 0
  if (s.held < p.dwell) return 'none'
  s.held = 0
  const out: IntentResult = c.level === 'universe' ? 'enter' : 'exit'
  intentCancel(s)
  return out
}

/** Planet-relative thresholds. enter < reveal start; exit sits well beyond the framing at planet level. */
export function proximityDistances(Rp: number, planetFraming: number) {
  const enter = Math.min(Rp * 7.5, planetFraming * 0.9)
  return {
    enter,
    revealStart: enter * 1.9,
    exit: Math.max(Rp * 13, planetFraming * 1.55),
  }
}

/** 0 (far) … 1 (at the entry distance): how much of the planet's orbital system is shown while approaching. */
export function revealAmount(dist: number, enter: number, revealStart: number): number {
  return Math.min(1, Math.max(0, (revealStart - dist) / Math.max(1e-6, revealStart - enter)))
}
