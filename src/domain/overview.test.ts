import { describe, expect, it } from 'vitest'
import { HALO, haloContent, haloTarget, moonWeight, rankGroups, universeBudget, universeLod, universeRadius, groupReach, labelBudget, OVERVIEW, overviewRadius, pickOverview, planetReach, rankTasks, satelliteCap } from './overview'
import { SAT_START, layoutGroups } from './layout'
import type { Group, Priority, Status, Task } from './types'

const NOW = new Date(2026, 5, 10, 12).getTime()
let n = 0
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${n++}`, planetId: 'p', groupId: 'g', title: 'x', description: '', dueDate: null, dueTime: null,
  priority: 'medium' as Priority, status: 'todo' as Status, subtasks: [], notes: [], links: [], attachments: [], completedAt: null, createdAt: n, updatedAt: n, ...over,
})
const group = (id: string, order = 0): Group => ({ id, planetId: 'p', name: id, description: '', symbol: '', color: '#fff', kind: 'auto', order, createdAt: 0, updatedAt: 0 })

describe('task ranking for the overview', () => {
  it('puts overdue and imminent work first, then critical, then in-progress, then by priority; done last', () => {
    const overdue = task({ title: 'overdue', priority: 'low', dueDate: '2026-06-08' })
    const imminent = task({ title: 'imminent', priority: 'low', dueDate: '2026-06-10', dueTime: '18:00' })
    const doing = task({ title: 'doing', status: 'doing', priority: 'low' })
    const critical = task({ title: 'critical', priority: 'critical' })
    const low = task({ title: 'low', priority: 'low' })
    const done = task({ title: 'done', status: 'done', priority: 'critical', completedAt: NOW })
    const order = rankTasks([done, low, critical, doing, imminent, overdue], NOW).map((t) => t.title)
    expect(order).toEqual(['overdue', 'imminent', 'critical', 'doing', 'low', 'done'])
  })

  it('never hides a prioritised task behind a low one when capping', () => {
    const urgent = task({ title: 'urgent', priority: 'critical', dueDate: '2026-06-09' })
    const many = Array.from({ length: 30 }, () => task({ priority: 'low' }))
    const shown = pickOverview([...many, urgent], 6, NOW)
    expect(shown).toHaveLength(6)
    expect(shown[0]!.title).toBe('urgent')
  })

  it('keeps the original data untouched', () => {
    const list = [task({ priority: 'low' }), task({ priority: 'critical' })]
    const copy = [...list]
    rankTasks(list, NOW)
    expect(list).toEqual(copy)
  })
})

describe('density budgets', () => {
  it('satellite budget shrinks with many groups and weaker graphics profiles, within sane bounds', () => {
    expect(satelliteCap(1, 'high')).toBe(14)
    expect(satelliteCap(10, 'high')).toBe(11)
    expect(satelliteCap(10, 'low')).toBe(4)
    expect(satelliteCap(40, 'low')).toBe(4)
    expect(satelliteCap(4, 'medium')).toBeLessThan(satelliteCap(4, 'high') + 1)
    for (const tier of ['low', 'medium', 'high'] as const) for (const g of [1, 3, 8, 20]) expect(satelliteCap(g, tier) * g).toBeLessThanOrEqual(Math.max(120, g * 4))
  })

  it('label budget: everything when few, rationed when many, smaller on small screens', () => {
    expect(labelBudget(5, 1440)).toBe(5)
    expect(labelBudget(20, 1440)).toBe(14)
    expect(labelBudget(80, 1440)).toBe(9)
    expect(labelBudget(80, 1000)).toBeLessThan(labelBudget(80, 1920))
    expect(labelBudget(1, 1000)).toBe(3) // never below a readable minimum
  })

  it('halo detail: only while hovered or approached', () => {
    expect(haloTarget({ hovered: false, zoomFocus: false })).toBe(0)
    expect(haloTarget({ hovered: true, zoomFocus: false })).toBe(1)
    expect(haloTarget({ hovered: false, zoomFocus: true })).toBe(1)
  })
})

describe('orbits and moons seen from the universe', () => {
  it('level of detail grows with the apparent size of the planet and hover never hides it', () => {
    expect(universeLod({ pxRadius: 5, hovered: false, zoomFocus: false })).toBe(0)
    const a = universeLod({ pxRadius: 14, hovered: false, zoomFocus: false })
    const b = universeLod({ pxRadius: 22, hovered: false, zoomFocus: false })
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(universeLod({ pxRadius: 40, hovered: false, zoomFocus: false })).toBe(1)
    expect(universeLod({ pxRadius: 5, hovered: true, zoomFocus: false })).toBeGreaterThanOrEqual(0.7)
  })

  it('budget follows the profile and the screen and never reaches zero', () => {
    expect(universeBudget('low', 1440).systems).toBeLessThan(universeBudget('high', 1440).systems)
    expect(universeBudget('high', 800).moons).toBeLessThan(universeBudget('high', 1440).moons)
    expect(universeBudget('high', 2560).moons).toBeGreaterThanOrEqual(universeBudget('high', 1440).moons)
    const tiny = universeBudget('low', 600)
    expect(tiny.systems).toBeGreaterThanOrEqual(1)
    expect(tiny.moons).toBeGreaterThanOrEqual(2)
  })

  it('moons appear in order of importance as detail grows', () => {
    expect(moonWeight(0, 0, 8)).toBeCloseTo(0.5)
    expect(moonWeight(0.1, 0, 8)).toBe(1)
    expect(moonWeight(0.3, 1, 8)).toBe(1)
    expect(moonWeight(0.3, 5, 8)).toBe(0)
    expect(moonWeight(1, 7, 8)).toBe(1)
    for (let r = 0; r < 7; r++) expect(moonWeight(0.4, r, 8)).toBeGreaterThanOrEqual(moonWeight(0.4, r + 1, 8))
  })

  it('compressed moon orbits stay inside the room between neighbouring planets', () => {
    // planets sit at least 10.5 apart, the biggest has radius 2.8: three lanes must stay under half of that
    expect(universeRadius(2.8, 2) + 0.3).toBeLessThan(10.5 / 2 + 1.5)
    expect(universeRadius(2, 1)).toBeGreaterThan(universeRadius(2, 0))
    expect(universeRadius(2, 0)).toBeGreaterThan(2 * 1.3)
  })

  it('ranks groups: urgent work, then open tasks, then own order', () => {
    const a = group('a', 0)
    const b = group('b', 1)
    const c = group('c', 2)
    const tasks = [
      task({ groupId: 'a' }),
      task({ groupId: 'b' }),
      task({ groupId: 'b' }),
      task({ groupId: 'c', dueDate: '2026-06-09' }),
      task({ groupId: 'a', status: 'done', completedAt: NOW }),
    ]
    expect(rankGroups([a, b, c], tasks, NOW).map((g) => g.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('orbital reach & moon lanes', () => {
  it('overview orbits are compressed but ordered like the focused view', () => {
    expect(overviewRadius(SAT_START)).toBeCloseTo(OVERVIEW.start)
    expect(overviewRadius(SAT_START + 3)).toBeGreaterThan(overviewRadius(SAT_START))
    expect(overviewRadius(SAT_START + 3) - OVERVIEW.start).toBeLessThan(3)
  })

  it('reach grows with the variety of tasks and is capped', () => {
    expect(groupReach([])).toBe(0)
    const one = groupReach([task()])
    const mixed = groupReach(['critical', 'high', 'medium', 'low'].map((p) => task({ priority: p as Priority })).concat(task({ status: 'done' })))
    expect(mixed).toBeGreaterThan(one)
    expect(mixed).toBeLessThanOrEqual(OVERVIEW.maxReach)
  })

  it('moon lanes leave room for the satellites and never overlap, however many groups', () => {
    const groups = Array.from({ length: 24 }, (_, i) => group(`g${i}`, i))
    const reach = 2.8
    const { slots } = layoutGroups(groups, 2, reach)
    const lanes = new Map<number, number>()
    for (const s of slots.values()) lanes.set(s.lane, s.radius)
    const radii = [...lanes.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1])
    for (let i = 1; i < radii.length; i++) expect(radii[i]! - radii[i - 1]!).toBeGreaterThanOrEqual(reach * 2)
    // neighbours in the same lane are further apart than two reaches
    for (const [lane, r] of lanes) {
      const inLane = [...slots.values()].filter((s) => s.lane === lane)
      if (inLane.length > 1) expect((2 * Math.PI * r) / inLane.length).toBeGreaterThan(reach * 2)
    }
    // innermost satellites stay clear of the planet's progress ring (1.62 × 2)
    expect(radii[0]! - reach).toBeGreaterThan(2 * 1.62)
  })

  it('without tasks the layout is exactly the previous one (no regression)', () => {
    const groups = Array.from({ length: 4 }, (_, i) => group(`g${i}`, i))
    const a = layoutGroups(groups, 2)
    const b = layoutGroups(groups, 2, 0)
    expect([...a.slots.values()]).toEqual([...b.slots.values()])
    expect(a.slots.get('g0')!.radius).toBeCloseTo(2 * 1.9 + 2.4)
  })

  it('planetReach considers the busiest group', () => {
    const groups = [group('g'), group('h', 1)]
    const tasks = [task(), ...['critical', 'high', 'low'].map((p) => task({ groupId: 'h', priority: p as Priority }))]
    expect(planetReach(groups, tasks, 10)).toBeGreaterThan(groupReach([task()]))
    expect(planetReach(groups, [], 10)).toBe(0)
  })
})

describe('summary shown around a hovered planet', () => {
  it('lists the busiest groups first, only open tasks, capped per group', () => {
    const quiet = group('quiet', 0)
    const busy = group('busy', 1)
    const urgent = group('urgent', 2)
    const empty = group('empty', 3)
    const tasks = [
      task({ groupId: 'quiet' }),
      ...Array.from({ length: 9 }, () => task({ groupId: 'busy' })),
      task({ groupId: 'urgent', dueDate: '2026-06-09' }),
      task({ groupId: 'quiet', status: 'done', completedAt: NOW }),
    ]
    const out = haloContent([quiet, busy, urgent, empty], tasks, NOW)
    expect(out.map((r) => r.group.id)).toEqual(['urgent', 'busy', 'quiet'])
    expect(out[1]!.tasks).toHaveLength(HALO.tasksPerGroup)
    expect(out[1]!.more).toBe(9 - HALO.tasksPerGroup)
    expect(out.every((r) => r.tasks.every((t) => t.status !== 'done'))).toBe(true)
  })

  it('never draws more groups than the limit', () => {
    const groups = Array.from({ length: 12 }, (_, i) => group(`g${i}`, i))
    const tasks = groups.map((g) => task({ groupId: g.id }))
    expect(haloContent(groups, tasks, NOW)).toHaveLength(HALO.maxGroups)
  })
})
