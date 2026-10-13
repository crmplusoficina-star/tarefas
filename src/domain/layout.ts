import type { Group, Planet, Priority, Task } from './types'
import { dueTimestamp } from './time'

/* ------------------------------------------------------------------ *
 * Universe: planets live on discrete orbital lanes. Planets on the
 * same lane share the same angular speed, so a spacing that is valid
 * once is valid forever → no overlap, no matter how many planets.
 * ------------------------------------------------------------------ */

export const LANE_BASE = 17
export const LANE_STEP = 9
/** minimum arc distance between planet centres on one lane */
export const LANE_MIN_GAP = 10.5

export const laneRadius = (lane: number) => LANE_BASE + lane * LANE_STEP
export const laneCapacity = (lane: number) => Math.max(1, Math.floor((2 * Math.PI * laneRadius(lane)) / LANE_MIN_GAP))
export const laneMinAngle = (lane: number) => LANE_MIN_GAP / laneRadius(lane)
/** Angular speed (rad/s at orbitSpeed = 1) */
export const laneOmega = (lane: number) => 0.05 / (1 + lane * 0.38)
export const laneHeight = (lane: number) => Math.sin(lane * 1.9 + 0.6) * 1.1

export const TAU = Math.PI * 2

export const wrapAngle = (a: number) => {
  let r = a % TAU
  if (r > Math.PI) r -= TAU
  if (r < -Math.PI) r += TAU
  return r
}

export const laneFromRadius = (r: number) => Math.max(0, Math.round((r - LANE_BASE) / LANE_STEP))

type Slot = Pick<Planet, 'id' | 'lane' | 'phase'>

function circularGap(a: number, b: number) {
  return Math.abs(wrapAngle(a - b))
}

function isFree(others: Slot[], lane: number, phase: number) {
  const min = laneMinAngle(lane)
  return others.every((o) => o.lane !== lane || circularGap(o.phase, phase) >= min)
}

/** Place a planet automatically: first lane with room, in the middle of the largest free arc. */
export function autoPlace(others: Slot[]): { lane: number; phase: number } {
  for (let lane = 0; ; lane++) {
    const inLane = others.filter((o) => o.lane === lane).map((o) => o.phase)
    if (inLane.length >= laneCapacity(lane)) continue
    if (inLane.length === 0) return { lane, phase: wrapAngle(lane * 2.399963 + 0.4) }
    const sorted = [...inLane].map((p) => ((p % TAU) + TAU) % TAU).sort((a, b) => a - b)
    let bestGap = -1
    let bestMid = 0
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!
      const b = i === sorted.length - 1 ? sorted[0]! + TAU : sorted[i + 1]!
      const gap = b - a
      if (gap > bestGap) {
        bestGap = gap
        bestMid = a + gap / 2
      }
    }
    if (bestGap >= laneMinAngle(lane) * 2) return { lane, phase: wrapAngle(bestMid) }
  }
}

/**
 * Resolve a manual placement request (e.g. drag & drop) into a collision-free slot:
 * keep the requested lane/phase when possible, slide along the lane otherwise,
 * and move outward when the lane is full.
 */
export function resolvePlacement(others: Slot[], lane: number, phase: number): { lane: number; phase: number } {
  for (let l = Math.max(0, lane); ; l++) {
    const count = others.filter((o) => o.lane === l).length
    if (count >= laneCapacity(l)) continue
    if (isFree(others, l, phase)) return { lane: l, phase: wrapAngle(phase) }
    const step = 0.01
    for (let d = step; d <= Math.PI; d += step) {
      if (isFree(others, l, phase + d)) return { lane: l, phase: wrapAngle(phase + d) }
      if (isFree(others, l, phase - d)) return { lane: l, phase: wrapAngle(phase - d) }
    }
  }
}

/** Evenly spread everything, keeping the dock order. */
export function autoArrange(planets: Planet[]): Map<string, { lane: number; phase: number }> {
  const out = new Map<string, { lane: number; phase: number }>()
  const placed: Slot[] = []
  for (const p of [...planets].sort((a, b) => a.order - b.order)) {
    const slot = autoPlace(placed)
    out.set(p.id, slot)
    placed.push({ id: p.id, ...slot })
  }
  return out
}

export function universeExtent(planets: Pick<Planet, 'lane'>[]): number {
  const maxLane = planets.reduce((m, p) => Math.max(m, p.lane), -1)
  return maxLane < 0 ? LANE_BASE : laneRadius(maxLane)
}

export const planetRadius = (size: number) => 2 * size

/* ------------------------------------------------------------------ *
 * Planet view: groups orbit the planet as moons / stations.
 * ------------------------------------------------------------------ */

export interface MoonSlot {
  id: string
  lane: number
  radius: number
  phase: number
  omega: number
}

export const MOON_RADIUS = 0.62

export function layoutGroups(groups: Group[], planetR: number): { slots: Map<string, MoonSlot>; extent: number } {
  const slots = new Map<string, MoonSlot>()
  const sorted = [...groups].sort((a, b) => a.order - b.order)
  let idx = 0
  let lane = 0
  let extent = planetR * 2.2
  while (idx < sorted.length) {
    const cap = 3 + lane * 2
    const radius = planetR * 1.9 + 2.4 + lane * 2.7
    const inLane = sorted.slice(idx, idx + cap)
    inLane.forEach((g, i) => {
      slots.set(g.id, {
        id: g.id,
        lane,
        radius,
        phase: (i * TAU) / inLane.length + lane * 1.13,
        omega: 0.14 / (1 + lane * 0.42),
      })
    })
    extent = radius
    idx += cap
    lane++
  }
  return { slots, extent }
}

/* ------------------------------------------------------------------ *
 * Group view: tasks orbit the moon as satellites, banded by priority.
 * ------------------------------------------------------------------ */

export type Band = Priority | 'done'
export const BAND_ORDER: Band[] = ['critical', 'high', 'medium', 'low', 'done']

export interface SatSlot {
  id: string
  band: Band
  radius: number
  phase: number
  omega: number
}

export interface BandInfo {
  band: Band
  inner: number
  outer: number
  count: number
}

export const SAT_START = 2.6
const SAT_ARC = 1.05
const SAT_RING_GAP = 0.6
const SAT_BAND_GAP = 0.85

export function layoutTasks(tasks: Task[]): { slots: Map<string, SatSlot>; bands: BandInfo[]; extent: number } {
  const slots = new Map<string, SatSlot>()
  const bands: BandInfo[] = []
  let r = SAT_START
  for (const band of BAND_ORDER) {
    const inBand = tasks
      .filter((t) => (band === 'done' ? t.status === 'done' : t.status !== 'done' && t.priority === band))
      .sort((a, b) => (dueTimestamp(a) ?? Infinity) - (dueTimestamp(b) ?? Infinity) || a.createdAt - b.createdAt)
    if (inBand.length === 0) continue
    const inner = r
    let idx = 0
    let ring = 0
    while (idx < inBand.length) {
      const cap = Math.max(3, Math.floor((TAU * r) / SAT_ARC))
      const chunk = inBand.slice(idx, idx + cap)
      const bandSpeed = band === 'done' ? 0.4 : 1
      chunk.forEach((t, i) => {
        slots.set(t.id, {
          id: t.id,
          band,
          radius: r,
          phase: (i * TAU) / chunk.length + ring * 0.7 + bands.length * 0.9,
          omega: (0.34 / (1 + (r - SAT_START) * 0.16)) * bandSpeed,
        })
      })
      idx += cap
      ring++
      if (idx < inBand.length) r += SAT_RING_GAP
    }
    bands.push({ band, inner, outer: r, count: inBand.length })
    r += SAT_BAND_GAP
  }
  return { slots, bands, extent: bands.length ? bands[bands.length - 1]!.outer : SAT_START }
}
