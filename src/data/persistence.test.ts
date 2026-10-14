import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { emptyUniverse } from '../state/dataStore'
import * as M from '../state/model'
import { buildSampleUniverse } from '../state/sample'
import { defaultStyle } from '../domain/presets'
import { parseBackup, serializeBackup } from './backup'
import { IndexedDbAdapter } from './indexeddb'
import { MemoryAdapter } from './memory'
import { diffData, loadUniverse, Persister } from './persistence'

describe('diffData', () => {
  it('emits only changed records', () => {
    const a = buildSampleUniverse(emptyUniverse())
    const t = a.tasks[0]!
    const b = M.patchTask(a, t.id, { title: 'Novo título' })
    const ops = diffData(a, b)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ type: 'put', store: 'tasks' })
    const c = M.removeTask(b, t.id)
    expect(diffData(b, c).some((o) => o.type === 'delete' && o.store === 'tasks' && o.key === t.id)).toBe(true)
  })
})

describe('IndexedDB persistence (survives a "page refresh")', () => {
  it('round-trips planets, groups, tasks and settings', async () => {
    const factory = new IDBFactory()
    const first = await IndexedDbAdapter.open(factory, 'test-db')
    const persister = new Persister(first, 0)

    let d = emptyUniverse()
    persister.enqueue(diffData(d, (d = M.patchSettings(d, { universeName: 'Cosmos SEP' }))))
    const p = M.addPlanet(d, { name: 'SEP', description: 'd', symbol: '⚙', style: defaultStyle() })
    persister.enqueue(diffData(d, p.data))
    d = p.data
    const g = M.addGroup(d, p.id, { name: 'Auditorias', color: '#aaaaaa', kind: 'station' })
    persister.enqueue(diffData(d, g.data))
    d = g.data
    const t = M.addTask(d, { groupId: g.id!, title: 'Auditar', dueDate: '2026-07-01', dueTime: '10:00', priority: 'high', subtasks: [M.newSubtask('a')] })
    persister.enqueue(diffData(d, t.data))
    d = t.data
    await persister.flush()

    // "refresh": a brand-new adapter instance over the same database
    const reopened = await IndexedDbAdapter.open(factory, 'test-db')
    const loaded = await loadUniverse(reopened)
    expect(loaded.fresh).toBe(false)
    expect(loaded.dropped).toBe(0)
    expect(loaded.data.settings.universeName).toBe('Cosmos SEP')
    expect(loaded.data.planets).toHaveLength(1)
    expect(loaded.data.groups[0]!.kind).toBe('station')
    expect(loaded.data.tasks[0]).toMatchObject({ title: 'Auditar', priority: 'high', dueTime: '10:00' })
    expect(loaded.data.tasks[0]!.subtasks).toHaveLength(1)

    // deletions persist too
    const removed = M.removeTask(d, t.id!)
    persister.enqueue(diffData(d, removed))
    await persister.flush()
    const after = await loadUniverse(await IndexedDbAdapter.open(factory, 'test-db'))
    expect(after.data.tasks).toHaveLength(0)
    expect(after.data.groups).toHaveLength(1)
  })

  it('reports a fresh store as fresh', async () => {
    const adapter = await IndexedDbAdapter.open(new IDBFactory(), 'empty-db')
    expect((await loadUniverse(adapter)).fresh).toBe(true)
  })

  it('replaceAll swaps the whole content', async () => {
    const adapter = new MemoryAdapter()
    const persister = new Persister(adapter, 0)
    const sample = buildSampleUniverse(emptyUniverse())
    await persister.replaceAll(sample)
    expect((await loadUniverse(adapter)).data.tasks).toHaveLength(sample.tasks.length)
    await persister.replaceAll(emptyUniverse())
    expect((await loadUniverse(adapter)).data.planets).toHaveLength(0)
  })

  it('coalesces repeated writes to the same record', async () => {
    const calls: number[] = []
    const adapter = new MemoryAdapter()
    const original = adapter.apply.bind(adapter)
    adapter.apply = async (ops) => {
      calls.push(ops.length)
      return original(ops)
    }
    const persister = new Persister(adapter, 0)
    const base = buildSampleUniverse(emptyUniverse())
    const id = base.tasks[0]!.id
    let cur = base
    for (let i = 0; i < 5; i++) {
      const next = M.patchTask(cur, id, { title: `v${i}` })
      persister.enqueue(diffData(cur, next))
      cur = next
    }
    await persister.flush()
    expect(calls).toEqual([1])
  })
})

describe('backup', () => {
  it('exports and re-imports losslessly', () => {
    const d = buildSampleUniverse(emptyUniverse())
    const res = parseBackup(serializeBackup(d))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.dropped).toBe(0)
      expect(res.data.tasks).toHaveLength(d.tasks.length)
      expect(res.data.planets.map((p) => p.name)).toEqual(d.planets.map((p) => p.name))
    }
  })

  it('rejects garbage and foreign files', () => {
    expect(parseBackup('not json').ok).toBe(false)
    expect(parseBackup('{"hello":1}').ok).toBe(false)
  })

  it('repairs corrupted records instead of crashing', () => {
    const d = buildSampleUniverse(emptyUniverse())
    const broken = JSON.parse(serializeBackup(d))
    broken.data.tasks[0] = { id: 'x' }
    broken.data.tasks.push({ id: 'orphan', planetId: 'nope', groupId: 'nope', title: 'o' })
    broken.data.planets[0].style = 'banana'
    const res = parseBackup(JSON.stringify(broken))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.dropped).toBe(2)
      expect(res.data.planets[0]!.style.colors.primary).toMatch(/^#/)
    }
  })
})

describe('attachments in storage and backup', () => {
  const rec = (id: string, taskId: string, bytes: number[]) => ({ id, taskId, name: `${id}.pdf`, type: 'application/pdf', size: bytes.length, addedAt: 1, data: new Uint8Array(bytes).buffer })

  it('IndexedDB keeps file bytes across a reopen and clear() removes them', async () => {
    const factory = new IDBFactory()
    const a = await IndexedDbAdapter.open(factory, 'files-db')
    await a.putFile(rec('f1', 't1', [1, 2, 3]))
    await a.putFile(rec('f2', 't1', [4]))
    const b = await IndexedDbAdapter.open(factory, 'files-db')
    expect((await b.listFileIds()).sort()).toEqual(['f1', 'f2'])
    expect([...new Uint8Array((await b.getFile('f1'))!.data)]).toEqual([1, 2, 3])
    await b.deleteFile('f2')
    expect(await b.listFileIds()).toEqual(['f1'])
    expect(await b.loadFiles()).toHaveLength(1)
    await b.clear()
    expect(await b.listFileIds()).toEqual([])
  })

  it('upgrades a version-1 database without losing data', async () => {
    const factory = new IDBFactory()
    await new Promise<void>((resolve, reject) => {
      const r = factory.open('old-db', 1)
      r.onupgradeneeded = () => {
        const db = r.result
        for (const s of ['planets', 'groups', 'tasks']) db.createObjectStore(s, { keyPath: 'id' })
        db.createObjectStore('meta', { keyPath: 'key' })
      }
      r.onsuccess = () => {
        const tx = r.result.transaction('planets', 'readwrite')
        tx.objectStore('planets').put({ id: 'p1', name: 'Antigo', style: defaultStyle() })
        tx.oncomplete = () => {
          r.result.close()
          resolve()
        }
      }
      r.onerror = () => reject(r.error)
    })
    const upgraded = await IndexedDbAdapter.open(factory, 'old-db')
    expect((await upgraded.loadAll()).planets).toHaveLength(1)
    await upgraded.putFile(rec('n1', 't', [1]))
    expect(await upgraded.listFileIds()).toEqual(['n1'])
  })

  it('backup carries only the files tasks still point to and drops attachments whose bytes are missing', () => {
    let d = buildSampleUniverse(emptyUniverse())
    const t = d.tasks[0]!
    d = M.patchTask(d, t.id, {
      attachments: [
        { id: 'keep', name: 'a.pdf', type: 'application/pdf', size: 3, addedAt: 1 },
        { id: 'lost', name: 'b.png', type: 'image/png', size: 9, addedAt: 2 },
      ],
    })
    const text = serializeBackup(d, [rec('keep', t.id, [1, 2, 3]), rec('orphan', t.id, [9])])
    expect(JSON.parse(text).files.map((f: { id: string }) => f.id)).toEqual(['keep'])
    const res = parseBackup(text)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.files.map((f) => f.id)).toEqual(['keep'])
      expect([...new Uint8Array(res.files[0]!.data)]).toEqual([1, 2, 3])
      expect(res.missingFiles).toBe(1)
      expect(res.data.tasks.find((x) => x.id === t.id)!.attachments.map((a) => a.id)).toEqual(['keep'])
    }
  })

  it('reads a schema-1 backup (no attachments at all)', () => {
    const d = buildSampleUniverse(emptyUniverse())
    const old = JSON.parse(serializeBackup(d))
    old.schema = 1
    delete old.files
    for (const t of old.data.tasks) delete t.attachments
    const res = parseBackup(JSON.stringify(old))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.files).toEqual([])
      expect(res.data.tasks.every((t) => t.attachments.length === 0)).toBe(true)
    }
  })

  it('encodes and decodes large binary content', () => {
    const big = new Uint8Array(200_000).map((_, i) => (i * 31) % 251)
    const d = buildSampleUniverse(emptyUniverse())
    const t = d.tasks[0]!
    const withAtt = M.patchTask(d, t.id, { attachments: [{ id: 'big', name: 'big.zip', type: '', size: big.length, addedAt: 1 }] })
    const res = parseBackup(serializeBackup(withAtt, [{ id: 'big', taskId: t.id, name: 'big.zip', type: '', size: big.length, addedAt: 1, data: big.buffer }]))
    expect(res.ok && new Uint8Array(res.files[0]!.data).every((v, i) => v === big[i])).toBe(true)
  })
})
