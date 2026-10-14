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

/** A file attached to a task: the bytes are kept apart from the (small) task records. */
export interface FileRecord {
  id: string
  taskId: string
  name: string
  type: string
  size: number
  addedAt: number
  data: ArrayBuffer
}

export interface StorageAdapter {
  readonly kind: 'indexeddb' | 'memory'
  /** true when data survives a page refresh */
  readonly durable: boolean
  loadAll(): Promise<RawSnapshot>
  apply(ops: WriteOp[]): Promise<void>
  /** every stored file including its bytes (backup) */
  loadFiles(): Promise<FileRecord[]>
  putFile(file: FileRecord): Promise<void>
  getFile(id: string): Promise<FileRecord | undefined>
  deleteFile(id: string): Promise<void>
  listFileIds(): Promise<string[]>
  /** removes planets, groups, tasks, settings and files */
  clear(): Promise<void>
}
