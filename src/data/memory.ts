import type { FileRecord, RawSnapshot, StorageAdapter, WriteOp } from './adapter'

/** Non-durable adapter: used in tests and when IndexedDB is unavailable (e.g. blocked storage). */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const
  readonly durable = false
  private stores = {
    planets: new Map<string, unknown>(),
    groups: new Map<string, unknown>(),
    tasks: new Map<string, unknown>(),
  }
  private settings: unknown
  private files = new Map<string, FileRecord>()

  async loadAll(): Promise<RawSnapshot> {
    return {
      planets: [...this.stores.planets.values()],
      groups: [...this.stores.groups.values()],
      tasks: [...this.stores.tasks.values()],
      settings: this.settings,
    }
  }

  async apply(ops: WriteOp[]): Promise<void> {
    for (const op of ops) {
      if (op.type === 'put') this.stores[op.store].set(op.value.id, structuredClone(op.value))
      else if (op.type === 'delete') this.stores[op.store].delete(op.key)
      else this.settings = structuredClone(op.value)
    }
  }

  async loadFiles(): Promise<FileRecord[]> {
    return [...this.files.values()].map((f) => ({ ...f, data: f.data.slice(0) }))
  }

  async putFile(file: FileRecord): Promise<void> {
    this.files.set(file.id, { ...file, data: file.data.slice(0) })
  }

  async getFile(id: string): Promise<FileRecord | undefined> {
    const f = this.files.get(id)
    return f ? { ...f, data: f.data.slice(0) } : undefined
  }

  async deleteFile(id: string): Promise<void> {
    this.files.delete(id)
  }

  async listFileIds(): Promise<string[]> {
    return [...this.files.keys()]
  }

  async clear(): Promise<void> {
    this.files.clear()
    this.stores.planets.clear()
    this.stores.groups.clear()
    this.stores.tasks.clear()
    this.settings = undefined
  }
}
