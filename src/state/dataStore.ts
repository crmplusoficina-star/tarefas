import { DEFAULT_SETTINGS, type UniverseData } from '../domain/types'
import { diffData, loadUniverse, openStorage, Persister } from '../data/persistence'
import type { StorageAdapter } from '../data/adapter'
import { createStore } from './store'

export interface DataState {
  data: UniverseData
  ready: boolean
  storage: { kind: StorageAdapter['kind']; durable: boolean; error: string | null }
  /** last write failure, cleared on the next successful write */
  saveError: string | null
  /** timestamp of the last successful write */
  savedAt: number | null
}

export const emptyUniverse = (): UniverseData => ({ planets: [], groups: [], tasks: [], settings: { ...DEFAULT_SETTINGS } })

export const dataStore = createStore<DataState>({
  data: emptyUniverse(),
  ready: false,
  storage: { kind: 'memory', durable: false, error: null },
  saveError: null,
  savedAt: null,
})

let persister: Persister | null = null
let undoStack: { label: string; data: UniverseData }[] = []

export interface InitReport {
  dropped: number
  fresh: boolean
}

export async function initData(adapterOverride?: StorageAdapter): Promise<InitReport> {
  let adapter = adapterOverride
  let error: string | null = null
  if (!adapter) {
    const opened = await openStorage()
    adapter = opened.adapter
    error = opened.error
  }
  let loaded: Awaited<ReturnType<typeof loadUniverse>>
  try {
    loaded = await loadUniverse(adapter)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    const { MemoryAdapter } = await import('../data/memory')
    adapter = new MemoryAdapter()
    loaded = await loadUniverse(adapter)
  }
  persister = new Persister(adapter)
  persister.onError = (e) => dataStore.set({ saveError: e.message })
  persister.onSaved = () => dataStore.set({ saveError: null, savedAt: Date.now() })
  undoStack = []
  dataStore.set({
    data: loaded.data,
    ready: true,
    storage: { kind: adapter.kind, durable: adapter.durable, error },
    saveError: null,
  })
  return { dropped: loaded.dropped, fresh: loaded.fresh }
}

/** Apply a pure transition and persist the resulting diff. */
export function mutate(fn: (d: UniverseData) => UniverseData): void {
  const prev = dataStore.get().data
  const next = fn(prev)
  if (next === prev) return
  dataStore.set({ data: next })
  persister?.enqueue(diffData(prev, next))
}

/** Remember the current state so a destructive action can be undone. */
export function checkpoint(label: string): void {
  undoStack.push({ label, data: dataStore.get().data })
  if (undoStack.length > 30) undoStack.shift()
}

export function canUndo(): boolean {
  return undoStack.length > 0
}

export function undo(): string | null {
  const entry = undoStack.pop()
  if (!entry) return null
  mutate(() => entry.data)
  return entry.label
}

export async function replaceData(data: UniverseData): Promise<void> {
  dataStore.set({ data })
  undoStack = []
  await persister?.replaceAll(data)
}

export function flushNow(): Promise<void> {
  return persister?.flush() ?? Promise.resolve()
}

export function currentData(): UniverseData {
  return dataStore.get().data
}
