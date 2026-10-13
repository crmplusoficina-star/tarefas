/**
 * Storage contract. The app only ever talks to this interface, so a future
 * backend (REST / Supabase / …) just needs another implementation of it.
 */
export type CollectionName = 'planets' | 'groups' | 'tasks'

export type WriteOp =
  | { type: 'put'; store: CollectionName; value: { id: string } }
  | { type: 'delete'; store: CollectionName; key: string }
  | { type: 'putSettings'; value: unknown }

export interface RawSnapshot {
  planets: unknown[]
  groups: unknown[]
  tasks: unknown[]
  settings: unknown | undefined
}

export interface StorageAdapter {
  readonly kind: 'indexeddb' | 'memory'
  /** true when data survives a page refresh */
  readonly durable: boolean
  loadAll(): Promise<RawSnapshot>
  apply(ops: WriteOp[]): Promise<void>
  clear(): Promise<void>
}
