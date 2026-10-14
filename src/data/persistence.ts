import type { Settings, UniverseData } from '../domain/types'
import { sanitizeUniverse } from '../domain/sanitize'
import type { CollectionName, FileRecord, StorageAdapter, WriteOp } from './adapter'
import { IndexedDbAdapter } from './indexeddb'
import { MemoryAdapter } from './memory'

/** Pure: which writes turn `prev` into `next`? Relies on immutable updates (reference equality). */
export function diffData(prev: UniverseData, next: UniverseData): WriteOp[] {
  const ops: WriteOp[] = []
  for (const store of ['planets', 'groups', 'tasks'] as CollectionName[]) {
    const before = prev[store] as { id: string }[]
    const after = next[store] as { id: string }[]
    if (before === after) continue
    const prevMap = new Map(before.map((x) => [x.id, x]))
    const nextIds = new Set<string>()
    for (const item of after) {
      nextIds.add(item.id)
      if (prevMap.get(item.id) !== item) ops.push({ type: 'put', store, value: item })
    }
    for (const item of before) if (!nextIds.has(item.id)) ops.push({ type: 'delete', store, key: item.id })
  }
  if (prev.settings !== next.settings) ops.push({ type: 'putSettings', value: next.settings satisfies Settings })
  return ops
}

export interface LoadResult {
  data: UniverseData
  adapter: StorageAdapter
  /** records that could not be repaired */
  dropped: number
  /** set when IndexedDB could not be used */
  storageError: string | null
  /** true when the store had no data at all */
  fresh: boolean
}

export async function openStorage(): Promise<{ adapter: StorageAdapter; error: string | null }> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB indisponível neste navegador')
    return { adapter: await IndexedDbAdapter.open(), error: null }
  } catch (e) {
    return { adapter: new MemoryAdapter(), error: e instanceof Error ? e.message : String(e) }
  }
}

export async function loadUniverse(adapter: StorageAdapter): Promise<Omit<LoadResult, 'adapter' | 'storageError'>> {
  const raw = await adapter.loadAll()
  const { data, report } = sanitizeUniverse(raw)
  const fresh = raw.planets.length === 0 && raw.groups.length === 0 && raw.tasks.length === 0 && raw.settings === undefined
  return { data, dropped: report.dropped, fresh }
}

/**
 * Write-behind persistence: batches mutations, serialises writes, and flushes
 * when the page is hidden so nothing is lost on refresh.
 */
export class Persister {
  private pending: WriteOp[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()
  private lastError: Error | null = null
  onError: (e: Error) => void = () => {}
  onSaved: () => void = () => {}

  constructor(
    private adapter: StorageAdapter,
    private delay = 120,
  ) {}

  enqueue(ops: WriteOp[]) {
    if (ops.length === 0) return
    this.pending.push(...ops)
    if (this.timer == null) this.timer = setTimeout(() => void this.flush(), this.delay)
  }

  flush(): Promise<void> {
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const batch = this.coalesce(this.pending)
    this.pending = []
    if (batch.length === 0) return this.chain
    this.chain = this.chain
      .then(() => this.adapter.apply(batch))
      .then(() => {
        this.lastError = null
        this.onSaved()
      })
      .catch((e: unknown) => {
        this.lastError = e instanceof Error ? e : new Error(String(e))
        this.onError(this.lastError)
      })
    return this.chain
  }

  /** keep only the last op per record */
  private coalesce(ops: WriteOp[]): WriteOp[] {
    const last = new Map<string, WriteOp>()
    for (const op of ops) {
      const key = op.type === 'putSettings' ? 'settings' : `${op.store}:${op.type === 'put' ? op.value.id : op.key}`
      last.delete(key)
      last.set(key, op)
    }
    return [...last.values()]
  }

  async replaceAll(data: UniverseData, files: FileRecord[] = []) {
    await this.flush()
    await this.chain.then(() => this.adapter.clear())
    const ops: WriteOp[] = [
      ...data.planets.map((value) => ({ type: 'put', store: 'planets', value }) as WriteOp),
      ...data.groups.map((value) => ({ type: 'put', store: 'groups', value }) as WriteOp),
      ...data.tasks.map((value) => ({ type: 'put', store: 'tasks', value }) as WriteOp),
      { type: 'putSettings', value: data.settings },
    ]
    await this.adapter.apply(ops)
    for (const f of files) await this.adapter.putFile(f)
  }

  get error() {
    return this.lastError
  }
}
