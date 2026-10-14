export type SurfaceKind = 'rocky' | 'gas' | 'ocean' | 'tech' | 'custom'
export type AtmosphereKind = 'none' | 'haze' | 'halo' | 'aurora' | 'storm' | 'clouds'
export type GroupKind = 'auto' | 'moon' | 'station' | 'asteroid'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type Status = 'todo' | 'doing' | 'blocked' | 'done'

export interface SurfaceMix {
  rock: number
  gas: number
  ocean: number
  tech: number
}

export interface PlanetStyle {
  surface: SurfaceKind
  colors: { primary: string; secondary: string; accent: string }
  /** 0..1 — scale of the surface features */
  detail: number
  /** 0..1 — turbulence / contrast */
  turbulence: number
  /** 0..1 — meaning depends on the surface (water level, band count, circuit density, relief) */
  coverage: number
  /** weights used by the "custom" surface */
  mix: SurfaceMix
  atmosphere: { kind: AtmosphereKind; color: string; intensity: number }
  /** 0.7..1.4 */
  size: number
  seed: number
  /** axial tilt in radians */
  tilt: number
}

export interface Planet {
  id: string
  name: string
  description: string
  symbol: string
  style: PlanetStyle
  /** orbital lane (0 = innermost). Planets of the same lane share the same angular speed. */
  lane: number
  /** angle (radians) at orbit clock t = 0 */
  phase: number
  /** order in the dock / numeric shortcuts */
  order: number
  createdAt: number
  updatedAt: number
}

export interface Group {
  id: string
  planetId: string
  name: string
  description: string
  symbol: string
  color: string
  kind: GroupKind
  order: number
  createdAt: number
  updatedAt: number
}

export interface Subtask {
  id: string
  title: string
  done: boolean
}

export interface Note {
  id: string
  text: string
  createdAt: number
}

/** Metadata of a file attached to a task; the bytes live in their own IndexedDB store (see data/adapter.ts). */
export interface Attachment {
  id: string
  name: string
  /** MIME type as reported by the browser ('' when unknown) */
  type: string
  size: number
  addedAt: number
}

export interface Task {
  id: string
  planetId: string
  groupId: string
  title: string
  description: string
  /** YYYY-MM-DD */
  dueDate: string | null
  /** HH:mm — only meaningful when dueDate is set */
  dueTime: string | null
  priority: Priority
  status: Status
  subtasks: Subtask[]
  notes: Note[]
  /** related tasks (same group) rendered as luminous connections */
  links: string[]
  attachments: Attachment[]
  completedAt: number | null
  createdAt: number
  updatedAt: number
}

export type EffectsLevel = 'auto' | 'minimal' | 'balanced' | 'cinematic'
export type MotionPref = 'system' | 'reduced' | 'full'

export interface Settings {
  universeName: string
  effects: EffectsLevel
  motion: MotionPref
  /** 0..2 multiplier for orbital speeds */
  orbitSpeed: number
  showLabels: boolean
  showOrbits: boolean
}

export interface UniverseData {
  planets: Planet[]
  groups: Group[]
  tasks: Task[]
  settings: Settings
}

export const SCHEMA_VERSION = 2

export const DEFAULT_SETTINGS: Settings = {
  universeName: 'Meu Universo',
  effects: 'auto',
  motion: 'system',
  orbitSpeed: 1,
  showLabels: true,
  showOrbits: true,
}

export const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low']
export const STATUSES: Status[] = ['todo', 'doing', 'blocked', 'done']

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
}

export const STATUS_LABEL: Record<Status, string> = {
  todo: 'Planejada',
  doing: 'Em órbita',
  blocked: 'Bloqueada',
  done: 'Concluída',
}
