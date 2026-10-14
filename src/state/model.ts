/**
 * Pure domain transitions: (data, args) → data. No I/O, no UI — easy to test and
 * identical regardless of the storage backend.
 */
import { autoArrange, autoPlace, resolvePlacement } from '../domain/layout'
import { newId } from '../domain/ids'
import { MIX_PRESETS } from '../domain/presets'
import type { Group, Note, Planet, PlanetStyle, Priority, Settings, Status, Subtask, Task, UniverseData } from '../domain/types'

const maxOrder = (xs: { order: number }[]) => xs.reduce((m, x) => Math.max(m, x.order), -1)

/* ----------------------------- planets ----------------------------- */

export interface PlanetInput {
  name: string
  description: string
  symbol: string
  style: PlanetStyle
  /** when omitted the planet is placed automatically */
  placement?: { lane: number; phase: number } | null
}

export function addPlanet(data: UniverseData, input: PlanetInput, now = Date.now(), id = newId('pl')): { data: UniverseData; id: string } {
  const slots = data.planets.map((p) => ({ id: p.id, lane: p.lane, phase: p.phase }))
  const slot = input.placement ? resolvePlacement(slots, input.placement.lane, input.placement.phase) : autoPlace(slots)
  const planet: Planet = {
    id,
    name: input.name.trim() || 'Novo planeta',
    description: input.description.trim(),
    symbol: input.symbol || '◐',
    style: normalizeStyle(input.style),
    lane: slot.lane,
    phase: slot.phase,
    order: maxOrder(data.planets) + 1,
    createdAt: now,
    updatedAt: now,
  }
  return { data: { ...data, planets: [...data.planets, planet] }, id }
}

function normalizeStyle(style: PlanetStyle): PlanetStyle {
  // non-custom surfaces always use their canonical blend
  return style.surface === 'custom' ? style : { ...style, mix: { ...MIX_PRESETS[style.surface] } }
}

export function editPlanet(data: UniverseData, id: string, input: Omit<PlanetInput, 'placement'> & { placement?: { lane: number; phase: number } | null }, now = Date.now()): UniverseData {
  const current = data.planets.find((p) => p.id === id)
  if (!current) return data
  let { lane, phase } = current
  if (input.placement) {
    const others = data.planets.filter((p) => p.id !== id)
    ;({ lane, phase } = resolvePlacement(others, input.placement.lane, input.placement.phase))
  }
  const next: Planet = {
    ...current,
    name: input.name.trim() || current.name,
    description: input.description.trim(),
    symbol: input.symbol || current.symbol,
    style: normalizeStyle(input.style),
    lane,
    phase,
    updatedAt: now,
  }
  return { ...data, planets: data.planets.map((p) => (p.id === id ? next : p)) }
}

export function placePlanet(data: UniverseData, id: string, lane: number, phase: number, now = Date.now()): UniverseData {
  const current = data.planets.find((p) => p.id === id)
  if (!current) return data
  const others = data.planets.filter((p) => p.id !== id)
  const slot = resolvePlacement(others, lane, phase)
  return { ...data, planets: data.planets.map((p) => (p.id === id ? { ...p, ...slot, updatedAt: now } : p)) }
}

export function removePlanet(data: UniverseData, id: string): UniverseData {
  return {
    ...data,
    planets: data.planets.filter((p) => p.id !== id),
    groups: data.groups.filter((g) => g.planetId !== id),
    tasks: data.tasks.filter((t) => t.planetId !== id),
  }
}

/** Move a planet one position earlier/later in the dock order. */
export function shiftPlanetOrder(data: UniverseData, id: string, dir: -1 | 1, now = Date.now()): UniverseData {
  const sorted = [...data.planets].sort((a, b) => a.order - b.order)
  const i = sorted.findIndex((p) => p.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= sorted.length) return data
  const a = sorted[i]!
  const b = sorted[j]!
  return {
    ...data,
    planets: data.planets.map((p) =>
      p.id === a.id ? { ...p, order: b.order, updatedAt: now } : p.id === b.id ? { ...p, order: a.order, updatedAt: now } : p,
    ),
  }
}

export function arrangePlanets(data: UniverseData, now = Date.now()): UniverseData {
  const slots = autoArrange(data.planets)
  return { ...data, planets: data.planets.map((p) => ({ ...p, ...slots.get(p.id)!, updatedAt: now })) }
}

/* ------------------------------ groups ------------------------------ */

export interface GroupInput {
  name: string
  description?: string
  symbol?: string
  color: string
  kind: Group['kind']
}

export function addGroup(data: UniverseData, planetId: string, input: GroupInput, now = Date.now(), id = newId('gr')): { data: UniverseData; id: string | null } {
  if (!data.planets.some((p) => p.id === planetId)) return { data, id: null }
  const siblings = data.groups.filter((g) => g.planetId === planetId)
  const group: Group = {
    id,
    planetId,
    name: input.name.trim() || 'Novo grupo',
    description: (input.description ?? '').trim(),
    symbol: input.symbol ?? '',
    color: input.color,
    kind: input.kind,
    order: maxOrder(siblings) + 1,
    createdAt: now,
    updatedAt: now,
  }
  return { data: { ...data, groups: [...data.groups, group] }, id }
}

export function editGroup(data: UniverseData, id: string, patch: Partial<GroupInput>, now = Date.now()): UniverseData {
  return {
    ...data,
    groups: data.groups.map((g) =>
      g.id === id
        ? {
            ...g,
            ...patch,
            name: patch.name !== undefined ? patch.name.trim() || g.name : g.name,
            updatedAt: now,
          }
        : g,
    ),
  }
}

export function removeGroup(data: UniverseData, id: string): UniverseData {
  return { ...data, groups: data.groups.filter((g) => g.id !== id), tasks: data.tasks.filter((t) => t.groupId !== id) }
}

export function shiftGroupOrder(data: UniverseData, id: string, dir: -1 | 1, now = Date.now()): UniverseData {
  const g = data.groups.find((x) => x.id === id)
  if (!g) return data
  const sorted = data.groups.filter((x) => x.planetId === g.planetId).sort((a, b) => a.order - b.order)
  const i = sorted.findIndex((x) => x.id === id)
  const j = i + dir
  if (j < 0 || j >= sorted.length) return data
  const a = sorted[i]!
  const b = sorted[j]!
  return {
    ...data,
    groups: data.groups.map((x) =>
      x.id === a.id ? { ...x, order: b.order, updatedAt: now } : x.id === b.id ? { ...x, order: a.order, updatedAt: now } : x,
    ),
  }
}

/* ------------------------------- tasks ------------------------------- */

export interface TaskInput {
  groupId: string
  title: string
  description?: string
  dueDate?: string | null
  dueTime?: string | null
  priority?: Priority
  status?: Status
  subtasks?: Subtask[]
  notes?: Note[]
  links?: string[]
}

export function addTask(data: UniverseData, input: TaskInput, now = Date.now(), id = newId('tk')): { data: UniverseData; id: string | null } {
  const group = data.groups.find((g) => g.id === input.groupId)
  if (!group) return { data, id: null }
  const status = input.status ?? 'todo'
  const task: Task = {
    id,
    planetId: group.planetId,
    groupId: group.id,
    title: input.title.trim() || 'Nova tarefa',
    description: input.description?.trim() ?? '',
    dueDate: input.dueDate ?? null,
    dueTime: input.dueDate ? (input.dueTime ?? null) : null,
    priority: input.priority ?? 'medium',
    status,
    subtasks: input.subtasks ?? [],
    notes: input.notes ?? [],
    links: [],
    attachments: [],
    completedAt: status === 'done' ? now : null,
    createdAt: now,
    updatedAt: now,
  }
  let next: UniverseData = { ...data, tasks: [...data.tasks, task] }
  for (const other of input.links ?? []) next = linkTasks(next, id, other, true, now)
  return { data: next, id }
}

export type TaskPatch = Partial<
  Pick<Task, 'title' | 'description' | 'dueDate' | 'dueTime' | 'priority' | 'status' | 'subtasks' | 'notes' | 'attachments' | 'completedAt'>
>

export function patchTask(data: UniverseData, id: string, patch: TaskPatch, now = Date.now()): UniverseData {
  const current = data.tasks.find((t) => t.id === id)
  if (!current) return data
  const next: Task = { ...current, ...patch, updatedAt: now }
  if (patch.title !== undefined) next.title = patch.title.trim() || current.title
  if (!next.dueDate) next.dueTime = null
  if (patch.status && patch.status !== current.status) {
    next.completedAt = patch.status === 'done' ? (patch.completedAt ?? now) : null
  } else if (patch.completedAt !== undefined && next.status === 'done') {
    next.completedAt = patch.completedAt
  }
  return { ...data, tasks: data.tasks.map((t) => (t.id === id ? next : t)) }
}

export function removeTask(data: UniverseData, id: string): UniverseData {
  return {
    ...data,
    tasks: data.tasks.filter((t) => t.id !== id).map((t) => (t.links.includes(id) ? { ...t, links: t.links.filter((l) => l !== id) } : t)),
  }
}

/** Move a task to another group (and therefore possibly another planet). Links to tasks left behind are dropped. */
export function moveTask(data: UniverseData, id: string, groupId: string, now = Date.now()): UniverseData {
  const task = data.tasks.find((t) => t.id === id)
  const group = data.groups.find((g) => g.id === groupId)
  if (!task || !group || task.groupId === groupId) return data
  const moved: Task = { ...task, groupId, planetId: group.planetId, links: [], updatedAt: now }
  return {
    ...data,
    tasks: data.tasks.map((t) => {
      if (t.id === id) return moved
      return t.links.includes(id) ? { ...t, links: t.links.filter((l) => l !== id) } : t
    }),
  }
}

export function linkTasks(data: UniverseData, a: string, b: string, on: boolean, now = Date.now()): UniverseData {
  if (a === b) return data
  const ta = data.tasks.find((t) => t.id === a)
  const tb = data.tasks.find((t) => t.id === b)
  if (!ta || !tb || ta.groupId !== tb.groupId) return data
  const upd = (t: Task, other: string): Task => {
    const has = t.links.includes(other)
    if (on === has) return t
    return { ...t, links: on ? [...t.links, other] : t.links.filter((l) => l !== other), updatedAt: now }
  }
  return { ...data, tasks: data.tasks.map((t) => (t.id === a ? upd(t, b) : t.id === b ? upd(t, a) : t)) }
}

export const newSubtask = (title: string): Subtask => ({ id: newId('st'), title: title.trim(), done: false })
export const newNote = (text: string, now = Date.now()): Note => ({ id: newId('nt'), text: text.trim(), createdAt: now })

/* ----------------------------- settings ----------------------------- */

export function patchSettings(data: UniverseData, patch: Partial<Settings>): UniverseData {
  const universeName = patch.universeName !== undefined ? patch.universeName.trim().slice(0, 60) || data.settings.universeName : undefined
  return { ...data, settings: { ...data.settings, ...patch, ...(universeName !== undefined ? { universeName } : {}) } }
}
