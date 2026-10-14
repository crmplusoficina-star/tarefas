import {
  DEFAULT_SETTINGS,
  PRIORITIES,
  STATUSES,
  type AtmosphereKind,
  type Attachment,
  type Group,
  type GroupKind,
  type Note,
  type Planet,
  type PlanetStyle,
  type Settings,
  type Subtask,
  type SurfaceKind,
  type Task,
  type UniverseData,
} from './types'
import { MIX_PRESETS, defaultStyle } from './presets'

/**
 * Defensive normalisation of persisted/imported data. Anything that cannot be
 * repaired is dropped and counted, so a corrupted record never takes the app down.
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const bool = (v: unknown, d = false) => (typeof v === 'boolean' ? v : d)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d)
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d

const SURFACE_KINDS: SurfaceKind[] = ['rocky', 'gas', 'ocean', 'tech', 'custom']
const ATMOS_KINDS: AtmosphereKind[] = ['none', 'haze', 'halo', 'aurora', 'storm', 'clouds']
const GROUP_KIND_LIST: GroupKind[] = ['auto', 'moon', 'station', 'asteroid']

export interface SanitizeReport {
  dropped: number
}

export function sanitizeStyle(raw: unknown): PlanetStyle {
  const d = defaultStyle()
  if (!isObj(raw)) return d
  const surface = oneOf(raw.surface, SURFACE_KINDS, d.surface)
  const colors = isObj(raw.colors) ? raw.colors : {}
  const mix = isObj(raw.mix) ? raw.mix : {}
  const atm = isObj(raw.atmosphere) ? raw.atmosphere : {}
  const base = MIX_PRESETS[surface]
  return {
    surface,
    colors: {
      primary: hex(colors.primary, d.colors.primary),
      secondary: hex(colors.secondary, d.colors.secondary),
      accent: hex(colors.accent, d.colors.accent),
    },
    detail: clamp(num(raw.detail, 0.5), 0, 1),
    turbulence: clamp(num(raw.turbulence, 0.5), 0, 1),
    coverage: clamp(num(raw.coverage, 0.5), 0, 1),
    mix: {
      rock: clamp(num(mix.rock, base.rock), 0, 1),
      gas: clamp(num(mix.gas, base.gas), 0, 1),
      ocean: clamp(num(mix.ocean, base.ocean), 0, 1),
      tech: clamp(num(mix.tech, base.tech), 0, 1),
    },
    atmosphere: {
      kind: oneOf(atm.kind, ATMOS_KINDS, d.atmosphere.kind),
      color: hex(atm.color, d.atmosphere.color),
      intensity: clamp(num(atm.intensity, 0.7), 0, 1),
    },
    size: clamp(num(raw.size, 1), 0.6, 1.5),
    seed: num(raw.seed, 1),
    tilt: clamp(num(raw.tilt, 0.3), -1.2, 1.2),
  }
}

export function sanitizePlanet(raw: unknown, fallbackOrder = 0): Planet | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null
  const now = Date.now()
  return {
    id: raw.id,
    name: str(raw.name, 'Planeta sem nome').slice(0, 80) || 'Planeta sem nome',
    description: str(raw.description).slice(0, 2000),
    symbol: str(raw.symbol, '◐').slice(0, 4) || '◐',
    style: sanitizeStyle(raw.style),
    lane: Math.max(0, Math.floor(num(raw.lane, 0))),
    phase: num(raw.phase, 0),
    order: num(raw.order, fallbackOrder),
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
  }
}

export function sanitizeGroup(raw: unknown, fallbackOrder = 0): Group | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.planetId !== 'string') return null
  const now = Date.now()
  return {
    id: raw.id,
    planetId: raw.planetId,
    name: str(raw.name, 'Grupo sem nome').slice(0, 80) || 'Grupo sem nome',
    description: str(raw.description).slice(0, 2000),
    symbol: str(raw.symbol, '').slice(0, 4),
    color: hex(raw.color, '#d8b48a'),
    kind: oneOf(raw.kind, GROUP_KIND_LIST, 'auto'),
    order: num(raw.order, fallbackOrder),
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
  }
}

function sanitizeSubtasks(raw: unknown): Subtask[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((s) =>
    isObj(s) && typeof s.id === 'string' ? [{ id: s.id, title: str(s.title).slice(0, 300), done: bool(s.done) }] : [],
  )
}

function sanitizeNotes(raw: unknown): Note[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((n) =>
    isObj(n) && typeof n.id === 'string'
      ? [{ id: n.id, text: str(n.text).slice(0, 5000), createdAt: num(n.createdAt, Date.now()) }]
      : [],
  )
}

function sanitizeAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Attachment[] = []
  for (const a of raw) {
    if (!isObj(a) || typeof a.id !== 'string' || !a.id || seen.has(a.id)) continue
    seen.add(a.id)
    out.push({
      id: a.id,
      name: str(a.name, 'arquivo').slice(0, 255) || 'arquivo',
      type: str(a.type).slice(0, 120),
      size: Math.max(0, Math.floor(num(a.size, 0))),
      addedAt: num(a.addedAt, Date.now()),
    })
  }
  return out
}

export function sanitizeTask(raw: unknown): Task | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.groupId !== 'string' || typeof raw.planetId !== 'string') return null
  const now = Date.now()
  const status = oneOf(raw.status, STATUSES, 'todo')
  const dueDate = typeof raw.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate) ? raw.dueDate : null
  const dueTime = dueDate && typeof raw.dueTime === 'string' && /^\d{2}:\d{2}$/.test(raw.dueTime) ? raw.dueTime : null
  return {
    id: raw.id,
    planetId: raw.planetId,
    groupId: raw.groupId,
    title: str(raw.title, 'Tarefa sem título').slice(0, 300) || 'Tarefa sem título',
    description: str(raw.description).slice(0, 10000),
    dueDate,
    dueTime,
    priority: oneOf(raw.priority, PRIORITIES, 'medium'),
    status,
    subtasks: sanitizeSubtasks(raw.subtasks),
    notes: sanitizeNotes(raw.notes),
    links: Array.isArray(raw.links) ? raw.links.filter((l): l is string => typeof l === 'string') : [],
    attachments: sanitizeAttachments(raw.attachments),
    completedAt: status === 'done' ? (typeof raw.completedAt === 'number' ? raw.completedAt : now) : null,
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
  }
}

export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS
  if (!isObj(raw)) return { ...d }
  return {
    universeName: str(raw.universeName, d.universeName).slice(0, 60) || d.universeName,
    effects: oneOf(raw.effects, ['auto', 'minimal', 'balanced', 'cinematic'] as const, d.effects),
    motion: oneOf(raw.motion, ['system', 'reduced', 'full'] as const, d.motion),
    orbitSpeed: clamp(num(raw.orbitSpeed, d.orbitSpeed), 0, 2),
    showLabels: bool(raw.showLabels, d.showLabels),
    showOrbits: bool(raw.showOrbits, d.showOrbits),
  }
}

/** Normalise a whole universe and repair referential integrity. */
export function sanitizeUniverse(raw: {
  planets?: unknown[]
  groups?: unknown[]
  tasks?: unknown[]
  settings?: unknown
}): { data: UniverseData; report: SanitizeReport } {
  let dropped = 0
  const planets: Planet[] = []
  const seenP = new Set<string>()
  ;(raw.planets ?? []).forEach((r, i) => {
    const p = sanitizePlanet(r, i)
    if (!p || seenP.has(p.id)) return void dropped++
    seenP.add(p.id)
    planets.push(p)
  })

  const groups: Group[] = []
  const seenG = new Set<string>()
  ;(raw.groups ?? []).forEach((r, i) => {
    const g = sanitizeGroup(r, i)
    if (!g || seenG.has(g.id) || !seenP.has(g.planetId)) return void dropped++
    seenG.add(g.id)
    groups.push(g)
  })

  const tasks: Task[] = []
  const groupPlanet = new Map(groups.map((g) => [g.id, g.planetId]))
  const seenT = new Set<string>()
  for (const r of raw.tasks ?? []) {
    const t = sanitizeTask(r)
    if (!t || seenT.has(t.id) || !groupPlanet.has(t.groupId)) {
      dropped++
      continue
    }
    seenT.add(t.id)
    // the group is the source of truth for the planet
    tasks.push({ ...t, planetId: groupPlanet.get(t.groupId)! })
  }
  // links must point at existing tasks of the same group
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const cleaned = tasks.map((t) => {
    const links = t.links.filter((id) => id !== t.id && byId.get(id)?.groupId === t.groupId)
    return links.length === t.links.length ? t : { ...t, links }
  })

  return { data: { planets, groups, tasks: cleaned, settings: sanitizeSettings(raw.settings) }, report: { dropped } }
}
