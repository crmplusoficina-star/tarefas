import type { CollectionName, FileRecord, RawSnapshot, StorageAdapter, WriteOp } from './adapter'

const DB_NAME = 'orbita'
const DB_VERSION = 2
const COLLECTIONS: CollectionName[] = ['planets', 'groups', 'tasks']
const META = 'meta'
const FILES = 'files'
const SETTINGS_KEY = 'settings'

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transação abortada'))
  })
}

export class IndexedDbAdapter implements StorageAdapter {
  readonly kind = 'indexeddb' as const
  readonly durable = true
  private constructor(private db: IDBDatabase) {}

  static open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IndexedDbAdapter> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = factory.open(name, DB_VERSION)
      } catch (e) {
        reject(e)
        return
      }
      request.onupgradeneeded = () => {
        const db = request.result
        for (const c of COLLECTIONS) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
        // v2: attachments (bytes live apart from the task records)
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' })
      }
      request.onsuccess = () => {
        const db = request.result
        // another tab upgrading the schema: close so it is not blocked
        db.onversionchange = () => db.close()
        resolve(new IndexedDbAdapter(db))
      }
      request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o IndexedDB'))
      request.onblocked = () => reject(new Error('Abertura do IndexedDB bloqueada por outra aba'))
    })
  }

  async loadAll(): Promise<RawSnapshot> {
    const tx = this.db.transaction([...COLLECTIONS, META], 'readonly')
    const [planets, groups, tasks, settingsRow] = await Promise.all([
      req(tx.objectStore('planets').getAll()),
      req(tx.objectStore('groups').getAll()),
      req(tx.objectStore('tasks').getAll()),
      req(tx.objectStore(META).get(SETTINGS_KEY)),
    ])
    return { planets, groups, tasks, settings: (settingsRow as { value?: unknown } | undefined)?.value }
  }

  async apply(ops: WriteOp[]): Promise<void> {
    if (ops.length === 0) return
    const tx = this.db.transaction([...COLLECTIONS, META], 'readwrite')
    for (const op of ops) {
      if (op.type === 'put') tx.objectStore(op.store).put(op.value)
      else if (op.type === 'delete') tx.objectStore(op.store).delete(op.key)
      else tx.objectStore(META).put({ key: SETTINGS_KEY, value: op.value })
    }
    await done(tx)
  }

  async loadFiles(): Promise<FileRecord[]> {
    const tx = this.db.transaction(FILES, 'readonly')
    return (await req(tx.objectStore(FILES).getAll())) as FileRecord[]
  }

  async putFile(file: FileRecord): Promise<void> {
    const tx = this.db.transaction(FILES, 'readwrite')
    tx.objectStore(FILES).put(file)
    await done(tx)
  }

  async getFile(id: string): Promise<FileRecord | undefined> {
    const tx = this.db.transaction(FILES, 'readonly')
    return (await req(tx.objectStore(FILES).get(id))) as FileRecord | undefined
  }

  async deleteFile(id: string): Promise<void> {
    const tx = this.db.transaction(FILES, 'readwrite')
    tx.objectStore(FILES).delete(id)
    await done(tx)
  }

  async listFileIds(): Promise<string[]> {
    const tx = this.db.transaction(FILES, 'readonly')
    return (await req(tx.objectStore(FILES).getAllKeys())) as string[]
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction([...COLLECTIONS, META, FILES], 'readwrite')
    for (const c of COLLECTIONS) tx.objectStore(c).clear()
    tx.objectStore(META).clear()
    tx.objectStore(FILES).clear()
    await done(tx)
  }
}
