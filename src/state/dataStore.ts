import { DEFAULT_SETTINGS, type UniverseData } from '../domain/types'
import { diffData, loadUniverse, openStorage, Persister } from '../data/persistence'
import type { FileRecord, StorageAdapter } from '../data/adapter'
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
let activeAdapter: StorageAdapter | null = null
/** ids of files written but not yet referenced by a task: the collector must leave them alone */
const protectedFiles = new Set<string>()
let gcTimer: ReturnType<typeof setTimeout> | null = null
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
  activeAdapter = adapter
  persister.onError = (e) => dataStore.set({ saveError: e.message })
  persister.onSaved = () => dataStore.set({ saveError: null, savedAt: Date.now() })
  undoStack = []
  dataStore.set({
    data: loaded.data,
    ready: true,
    storage: { kind: adapter.kind, durable: adapter.durable, error },
    saveError: null,
  })
  void collectFiles()
  return { dropped: loaded.dropped, fresh: loaded.fresh }
}

/** Apply a pure transition and persist the resulting diff. */
export function mutate(fn: (d: UniverseData) => UniverseData): void {
  const prev = dataStore.get().data
  const next = fn(prev)
  if (next === prev) return
  dataStore.set({ data: next })
  persister?.enqueue(diffData(prev, next))
  if (prev.tasks !== next.tasks) scheduleFileCollection()
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

export async function replaceData(data: UniverseData, files: FileRecord[] = []): Promise<void> {
  undoStack = []
  if (files.length === 0) {
    dataStore.set({ data })
    await persister?.replaceAll(data)
    return
  }
  // with attachments the bytes are stored first, so nothing on screen ever points to a file that is not there yet
  for (const f of files) protectedFiles.add(f.id)
  try {
    await persister?.replaceAll(data, files)
    dataStore.set({ data })
  } finally {
    for (const f of files) protectedFiles.delete(f.id)
  }
}

/* ------------------------------------------------------------ attachments */

/** Stores the bytes of an attachment. The caller then adds its metadata to the task with `mutate`. */
export async function saveFile(file: FileRecord): Promise<void> {
  if (!activeAdapter) throw new Error('Armazenamento indisponível')
  protectedFiles.add(file.id)
  try {
    await activeAdapter.putFile(file)
  } catch (e) {
    protectedFiles.delete(file.id)
    throw e
  }
}

/** Call once the task that owns the file has been saved (or when giving up on it). */
export function releaseFile(id: string): void {
  protectedFiles.delete(id)
}

export async function readFile(id: string): Promise<FileRecord | undefined> {
  return activeAdapter?.getFile(id)
}

export async function readAllFiles(): Promise<FileRecord[]> {
  return activeAdapter?.loadFiles() ?? []
}

/**
 * Deletes stored files no task refers to any more. What the undo history still points to is kept, so
 * undoing the deletion of a task, group or planet never finds its attachments gone.
 */
export async function collectFiles(): Promise<number> {
  const adapter = activeAdapter
  if (!adapter) return 0
  const keep = new Set<string>(protectedFiles)
  const collect = (d: UniverseData) => {
    for (const t of d.tasks) for (const a of t.attachments) keep.add(a.id)
  }
  const stored = await adapter.listFileIds()
  collect(dataStore.get().data)
  for (const e of undoStack) collect(e.data)
  let removed = 0
  for (const id of stored) {
    if (keep.has(id) || protectedFiles.has(id)) continue
    await adapter.deleteFile(id)
    removed++
  }
  return removed
}

function scheduleFileCollection() {
  if (gcTimer != null) clearTimeout(gcTimer)
  gcTimer = setTimeout(() => {
    gcTimer = null
    void collectFiles().catch(() => {})
  }, 4000)
}

export function flushNow(): Promise<void> {
  return persister?.flush() ?? Promise.resolve()
}

export function currentData(): UniverseData {
  return dataStore.get().data
}
