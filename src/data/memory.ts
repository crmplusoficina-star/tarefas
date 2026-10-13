import type { RawSnapshot, StorageAdapter, WriteOp } from './adapter'

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

  async clear(): Promise<void> {
    this.stores.planets.clear()
    this.stores.groups.clear()
    this.stores.tasks.clear()
    this.settings = undefined
  }
}
