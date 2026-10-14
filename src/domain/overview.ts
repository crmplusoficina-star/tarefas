import { SAT_START, layoutTasks } from './layout'
import { dueTimestamp, urgencyOf } from './time'
import type { Group, Task } from './types'

/**
 * Visual-density rules for showing tasks around their groups without opening each group.
 * Everything here is pure so it can be tested without a renderer.
 */

/** Compressed satellite orbits used while a planet is seen as a whole ("overview"). */
export const OVERVIEW = {
  /** radius of the innermost task orbit (moon radius is 0.62, its progress ring ≈ 1.1) */
  start: 2.1,
  /** how much the focused-group orbits are shrunk */
  scale: 0.48,
  /** satellite size relative to the focused view */
  satScale: 0.62,
  /** hard limit so a busy group never swallows its neighbours */
  maxReach: 4.2,
}

export const overviewRadius = (r: number) => OVERVIEW.start + (r - SAT_START) * OVERVIEW.scale

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const
const STATUS_RANK = { doing: 0, blocked: 1, todo: 2, done: 3 } as const

/**
 * Importance of a task for the overview: urgent and overdue first, then critical ones, then what is in
 * progress, then by priority and deadline. Completed tasks always come last.
 */
export function taskRank(t: Task, now: number): number[] {
  if (t.status === 'done') return [1, 0, 0, 0, 0, t.completedAt ? -t.completedAt : 0]
  const urgency = urgencyOf(t, now)
  // critical work is never outranked by something merely in progress
  return [0, -urgency, t.priority === 'critical' ? 0 : 1, STATUS_RANK[t.status], PRIORITY_RANK[t.priority], dueTimestamp(t) ?? Infinity, t.createdAt]
}

export function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0 && !Number.isNaN(d)) return d
  }
  return 0
}

export function rankTasks(tasks: Task[], now: number): Task[] {
  const keyed = tasks.map((t) => ({ t, k: taskRank(t, now) }))
  keyed.sort((x, y) => compareRank(x.k, y.k))
  return keyed.map((x) => x.t)
}

/**
 * How many satellites per group are drawn individually. Depends on the graphics profile and on
 * how many groups share the planet, so the whole system stays within a fixed budget.
 */
export function satelliteCap(groupCount: number, tier: 'low' | 'medium' | 'high'): number {
  const budget = tier === 'low' ? 32 : tier === 'medium' ? 64 : 110
  return Math.max(4, Math.min(14, Math.floor(budget / Math.max(1, groupCount))))
}

/** The tasks shown as individual satellites in the overview (the rest are summarised). */
export function pickOverview(tasks: Task[], cap: number, now: number): Task[] {
  return rankTasks(tasks, now).slice(0, cap)
}

/** Radial space (world units) a group's satellites occupy around its moon in the overview. */
export function groupReach(tasks: Task[]): number {
  if (tasks.length === 0) return 0
  const { extent } = layoutTasks(tasks)
  return Math.min(OVERVIEW.maxReach, overviewRadius(extent) + 0.3)
}

/**
 * Space a planet's moon lanes must leave for the satellites. Uses a time-independent ordering
 * (priority only) so the layout does not reshuffle every time a deadline gets closer.
 */
export function planetReach(groups: Group[], tasks: Task[], cap: number): number {
  let reach = 0
  for (const g of groups) {
    const own = tasks.filter((t) => t.groupId === g.id)
    const proxy = [...own]
      .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
      .slice(0, cap)
    reach = Math.max(reach, groupReach(proxy))
  }
  return reach
}

/**
 * How many task names may be written in the scene at once. Satellites stay visible; only text is
 * rationed. Fewer when there are many tasks or the viewport is small; collisions are removed later,
 * per frame, by priority.
 */
export function labelBudget(shownTasks: number, viewportWidth: number): number {
  const room = viewportWidth >= 1700 ? 1.35 : viewportWidth >= 1200 ? 1 : 0.7
  const base = shownTasks <= 10 ? shownTasks : shownTasks <= 30 ? 14 : 9
  return Math.max(3, Math.round(base * room))
}

/** Summary of a planet's tasks drawn over its moons: only while it is hovered or approached (0 = none, 1 = full). */
export function haloTarget(args: { hovered: boolean; zoomFocus: boolean }): number {
  return args.hovered || args.zoomFocus ? 1 : 0
}

export const HALO = { maxGroups: 6, tasksPerGroup: 5 }

export interface HaloGroup {
  group: Group
  /** the most important open tasks of the group (at most `HALO.tasksPerGroup`) */
  tasks: Task[]
  /** open tasks that are not drawn */
  more: number
}

/**
 * What the in-scene summary of a planet shows: its busiest groups (urgent first, then open tasks),
 * each with its most important open tasks. Groups with nothing open are left out.
 */
export function haloContent(groups: Group[], tasks: Task[], now: number): HaloGroup[] {
  const rows = groups.map((group) => {
    const open = rankTasks(
      tasks.filter((t) => t.groupId === group.id && t.status !== 'done'),
      now,
    )
    const urgent = open.filter((t) => urgencyOf(t, now) >= 2).length
    return { group, open, urgent }
  })
  return rows
    .filter((r) => r.open.length > 0)
    .sort((a, b) => b.urgent - a.urgent || b.open.length - a.open.length || a.group.order - b.group.order)
    .slice(0, HALO.maxGroups)
    .map((r) => ({ group: r.group, tasks: r.open.slice(0, HALO.tasksPerGroup), more: Math.max(0, r.open.length - HALO.tasksPerGroup) }))
}

/* ------------------------------------------------------------------ *
 * Orbital systems seen from the universe: every planet may show its own orbits and moons, within a
 * budget that follows the graphics profile, the screen size and the distance of the camera.
 * Only the drawing is limited: the data and the full planet view are never affected.
 * ------------------------------------------------------------------ */

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** Level of detail (0..1) of a planet's orbits/moons from how big the planet looks on screen. */
export function universeLod(args: { pxRadius: number; hovered: boolean; zoomFocus: boolean }): number {
  const base = smooth((args.pxRadius - 9) / 17)
  return args.hovered || args.zoomFocus ? Math.max(base, 0.7) : base
}

export interface UniverseBudget {
  /** planets that may draw orbits and moons at the same time */
  systems: number
  /** moons drawn around one planet at full detail */
  moons: number
}

export function universeBudget(tier: 'low' | 'medium' | 'high', viewportWidth: number): UniverseBudget {
  const base = tier === 'low' ? { systems: 3, moons: 3 } : tier === 'medium' ? { systems: 6, moons: 5 } : { systems: 10, moons: 8 }
  const room = viewportWidth < 900 ? 0.6 : viewportWidth >= 1700 ? 1.3 : 1
  return { systems: Math.max(1, Math.round(base.systems * room)), moons: Math.max(2, Math.round(base.moons * room)) }
}

/** How strongly the moon of a given importance rank is drawn (0..1) at a level of detail. */
export function moonWeight(lod: number, rank: number, maxMoons: number): number {
  return Math.min(1, Math.max(0, lod * maxMoons + 0.5 - rank))
}

/** Radius of a moon orbit while the planet is seen from the universe (small enough not to touch neighbours). */
export const universeRadius = (planetR: number, lane: number) => planetR * 1.45 + 0.7 + lane * 0.55

/** Moon scale seen from the universe relative to the planet view. */
export const UNIVERSE_MOON_SCALE = 0.45

/**
 * Groups ordered by how much they deserve a place among a limited number of moons: urgent work
 * first, then the number of open tasks, then the user's own order.
 */
export function rankGroups(groups: Group[], tasks: Task[], now: number): Group[] {
  const score = new Map<string, [number, number]>()
  for (const g of groups) score.set(g.id, [0, 0])
  for (const t of tasks) {
    const sc = score.get(t.groupId)
    if (!sc || t.status === 'done') continue
    sc[1]++
    if (urgencyOf(t, now) >= 2) sc[0]++
  }
  return [...groups].sort((a, b) => {
    const x = score.get(a.id)!
    const y = score.get(b.id)!
    return y[0] - x[0] || y[1] - x[1] || a.order - b.order
  })
}
