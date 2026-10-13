import { describe, expect, it } from 'vitest'
import { emptyUniverse } from './dataStore'
import * as M from './model'
import { buildSampleUniverse } from './sample'
import { defaultStyle } from '../domain/presets'

const planetInput = (name: string) => ({ name, description: '', symbol: '◐', style: defaultStyle() })

function seeded() {
  let d = emptyUniverse()
  const p = M.addPlanet(d, planetInput('SEP'))
  d = p.data
  const g1 = M.addGroup(d, p.id, { name: 'Auditorias', color: '#fff000', kind: 'auto' })
  d = g1.data
  const g2 = M.addGroup(d, p.id, { name: 'Relatórios', color: '#00ff00', kind: 'moon' })
  d = g2.data
  return { d, planetId: p.id, g1: g1.id!, g2: g2.id! }
}

describe('planets', () => {
  it('creates any number of planets without overlap', () => {
    let d = emptyUniverse()
    for (let i = 0; i < 40; i++) d = M.addPlanet(d, planetInput(`P${i}`)).data
    expect(d.planets).toHaveLength(40)
    const keys = new Set(d.planets.map((p) => `${p.lane}:${p.phase.toFixed(4)}`))
    expect(keys.size).toBe(40)
  })

  it('cascades deletion to groups and tasks', () => {
    const { d, planetId, g1 } = seeded()
    const t = M.addTask(d, { groupId: g1, title: 'x' })
    const gone = M.removePlanet(t.data, planetId)
    expect(gone.planets).toHaveLength(0)
    expect(gone.groups).toHaveLength(0)
    expect(gone.tasks).toHaveLength(0)
  })

  it('reorders planets in the dock', () => {
    let d = emptyUniverse()
    const a = M.addPlanet(d, planetInput('A'))
    const b = M.addPlanet(a.data, planetInput('B'))
    d = M.shiftPlanetOrder(b.data, b.id, -1)
    expect([...d.planets].sort((x, y) => x.order - y.order).map((p) => p.name)).toEqual(['B', 'A'])
  })

  it('canonicalises the surface mix for non-custom surfaces', () => {
    const p = M.addPlanet(emptyUniverse(), { ...planetInput('G'), style: { ...defaultStyle(), surface: 'gas' } })
    expect(p.data.planets[0]!.style.mix.gas).toBe(1)
  })
})

describe('tasks', () => {
  it('stores completion date automatically and clears it when reopened', () => {
    const { d, g1 } = seeded()
    const t = M.addTask(d, { groupId: g1, title: 'Fechar relatório' })
    const done = M.patchTask(t.data, t.id!, { status: 'done' }, 1234)
    expect(done.tasks[0]!.completedAt).toBe(1234)
    const reopened = M.patchTask(done, t.id!, { status: 'doing' })
    expect(reopened.tasks[0]!.completedAt).toBeNull()
  })

  it('allows editing the completion date of a done task', () => {
    const { d, g1 } = seeded()
    const t = M.addTask(d, { groupId: g1, title: 'a', status: 'done' }, 100)
    const edited = M.patchTask(t.data, t.id!, { completedAt: 500 })
    expect(edited.tasks[0]!.completedAt).toBe(500)
  })

  it('moves tasks between groups and planets, dropping stale links', () => {
    const { d, g1, g2 } = seeded()
    const a = M.addTask(d, { groupId: g1, title: 'a' })
    const b = M.addTask(a.data, { groupId: g1, title: 'b' })
    let next = M.linkTasks(b.data, a.id!, b.id!, true)
    expect(next.tasks.find((t) => t.id === a.id)!.links).toEqual([b.id])
    next = M.moveTask(next, a.id!, g2)
    expect(next.tasks.find((t) => t.id === a.id)!.groupId).toBe(g2)
    expect(next.tasks.find((t) => t.id === b.id)!.links).toEqual([])

    const other = M.addPlanet(next, planetInput('Viagens'))
    const og = M.addGroup(other.data, other.id, { name: 'Roteiro', color: '#fff', kind: 'auto' })
    const moved = M.moveTask(og.data, a.id!, og.id!)
    expect(moved.tasks.find((t) => t.id === a.id)!.planetId).toBe(other.id)
  })

  it('links only within the same group and is symmetric', () => {
    const { d, g1, g2 } = seeded()
    const a = M.addTask(d, { groupId: g1, title: 'a' })
    const b = M.addTask(a.data, { groupId: g2, title: 'b' })
    expect(M.linkTasks(b.data, a.id!, b.id!, true)).toBe(b.data)
  })

  it('removing a task removes links that point to it', () => {
    const { d, g1 } = seeded()
    const a = M.addTask(d, { groupId: g1, title: 'a' })
    const b = M.addTask(a.data, { groupId: g1, title: 'b', links: [a.id!] })
    const after = M.removeTask(b.data, a.id!)
    expect(after.tasks[0]!.links).toEqual([])
  })

  it('removes group tasks with the group', () => {
    const { d, g1 } = seeded()
    const a = M.addTask(d, { groupId: g1, title: 'a' })
    expect(M.removeGroup(a.data, g1).tasks).toHaveLength(0)
  })

  it('reorders groups', () => {
    const { d, g1, g2 } = seeded()
    const next = M.shiftGroupOrder(d, g2, -1)
    const order = [...next.groups].sort((a, b) => a.order - b.order).map((g) => g.id)
    expect(order).toEqual([g2, g1])
  })
})

describe('sample universe', () => {
  it('is consistent data', () => {
    const d = buildSampleUniverse(emptyUniverse())
    expect(d.planets.length).toBeGreaterThan(2)
    for (const t of d.tasks) expect(d.groups.find((g) => g.id === t.groupId)?.planetId).toBe(t.planetId)
  })
})
