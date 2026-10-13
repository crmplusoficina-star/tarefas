import type { AtmosphereKind, Group, Planet, PlanetStyle, Priority, SurfaceKind } from '../domain/types'
import { defaultStyle } from '../domain/presets'
import { createStore } from './store'

export type Level = 'universe' | 'planet' | 'group' | 'task'
export type Quality = 'low' | 'medium' | 'high'

export interface Hover {
  kind: 'planet' | 'group' | 'task'
  id: string
}

export interface LabDraft {
  name: string
  description: string
  symbol: string
  style: PlanetStyle
  /** null = automatic placement */
  placement: { lane: number; phase: number } | null
}

export interface LabState {
  editingId: string | null
  draft: LabDraft
  /** where to go back to when the lab closes */
  returnTo: { planetId: string | null; groupId: string | null; taskId: string | null }
}

export type TaskPanel =
  | { mode: 'edit' }
  | { mode: 'new'; planetId: string; groupId: string | null; priority?: Priority }

export type GroupDialog = { mode: 'new'; planetId: string } | { mode: 'edit'; id: string }

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'success' | 'warn' | 'error'
  action?: { label: string; run: () => void }
}

export interface Burst {
  key: number
  kind: 'complete' | 'form' | 'launch'
  target: { kind: 'planet' | 'group' | 'task'; id: string }
  color: string
  at: number
}

export interface UiState {
  planetId: string | null
  groupId: string | null
  taskId: string | null
  hover: Hover | null
  mode: 'explore' | 'arrange'
  lab: LabState | null
  taskPanel: TaskPanel | null
  groupDialog: GroupDialog | null
  groupManager: boolean
  settingsOpen: boolean
  searchOpen: boolean
  outlineOpen: boolean
  helpOpen: boolean
  confirm: ConfirmRequest | null
  toasts: Toast[]
  bursts: Burst[]
  forming: { id: string; startedAt: number } | null
  /** performance.now() until which the camera is in "cinematic flight" mode */
  flightUntil: number
  /** bumped on every navigation / recenter request so the camera drops manual offsets */
  navSeq: number
  /** quality chosen automatically from measured FPS */
  autoQuality: Quality
  /** planet whose orbital system is being revealed / hidden while zooming (no navigation yet) */
  peekPlanetId: string | null
  /** the next navigation continues from the current camera pose instead of re-framing */
  cameraKeep: boolean
  /** WebGL context could not be created */
  webglFailed: boolean
  announce: string
}

export const uiStore = createStore<UiState>({
  planetId: null,
  groupId: null,
  taskId: null,
  hover: null,
  mode: 'explore',
  lab: null,
  taskPanel: null,
  groupDialog: null,
  groupManager: false,
  settingsOpen: false,
  searchOpen: false,
  outlineOpen: false,
  helpOpen: false,
  confirm: null,
  toasts: [],
  bursts: [],
  forming: null,
  flightUntil: 0,
  navSeq: 0,
  autoQuality: 'high',
  peekPlanetId: null,
  cameraKeep: false,
  webglFailed: false,
  announce: '',
})

export function levelOf(s: Pick<UiState, 'planetId' | 'groupId' | 'taskId'>): Level {
  if (s.taskId) return 'task'
  if (s.groupId) return 'group'
  if (s.planetId) return 'planet'
  return 'universe'
}

export const FLIGHT_MS = 2400

export function startFlight(ms = FLIGHT_MS) {
  uiStore.set((s) => ({ flightUntil: performance.now() + ms, navSeq: s.navSeq + 1 }))
}

let toastSeq = 1
export function pushToast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action'], ttl = 6000): number {
  const id = toastSeq++
  uiStore.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone, action }] }))
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl)
  return id
}

export function dismissToast(id: number) {
  uiStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

let burstSeq = 1
export function spawnBurst(b: Omit<Burst, 'key' | 'at'>) {
  const key = burstSeq++
  uiStore.set((s) => ({ bursts: [...s.bursts.slice(-12), { ...b, key, at: performance.now() }] }))
}

export function removeBurst(key: number) {
  uiStore.set((s) => ({ bursts: s.bursts.filter((b) => b.key !== key) }))
}

export function askConfirm(req: ConfirmRequest) {
  uiStore.set({ confirm: req })
}

export function newLabDraft(): LabDraft {
  return { name: '', description: '', symbol: '◐', style: defaultStyle(), placement: null }
}

export function labFromPlanet(p: Planet): LabDraft {
  return {
    name: p.name,
    description: p.description,
    symbol: p.symbol,
    style: structuredClone(p.style),
    placement: null,
  }
}

export type { AtmosphereKind, Group, SurfaceKind }
