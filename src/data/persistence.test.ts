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
