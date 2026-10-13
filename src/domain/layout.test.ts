import { describe, expect, it } from 'vitest'
import { autoArrange, autoPlace, laneCapacity, laneMinAngle, layoutGroups, layoutTasks, resolvePlacement, wrapAngle } from './layout'
import type { Group, Planet, Task } from './types'

const slot = (id: string, lane: number, phase: number) => ({ id, lane, phase })

describe('planet lanes', () => {
  it('never overlaps, no matter how many planets are created', () => {
    const placed: ReturnType<typeof slot>[] = []
    for (let i = 0; i < 120; i++) {
      const s = autoPlace(placed)
      placed.push(slot(`p${i}`, s.lane, s.phase))
    }
    for (const a of placed)
      for (const b of placed) {
        if (a === b || a.lane !== b.lane) continue
        expect(Math.abs(wrapAngle(a.phase - b.phase))).toBeGreaterThanOrEqual(laneMinAngle(a.lane) - 1e-9)
      }
    expect(placed.filter((p) => p.lane === 0).length).toBeLessThanOrEqual(laneCapacity(0))
  })

  it('resolves manual placement collisions by sliding along the lane', () => {
    const others = [slot('a', 1, 0)]
    const r = resolvePlacement(others, 1, 0.01)
    expect(r.lane).toBe(1)
    expect(Math.abs(wrapAngle(r.phase))).toBeGreaterThanOrEqual(laneMinAngle(1) - 1e-9)
  })

  it('moves outward when the requested lane is full', () => {
    const others = Array.from({ length: laneCapacity(0) }, (_, i) => slot(`p${i}`, 0, (i * Math.PI * 2) / laneCapacity(0)))
    expect(resolvePlacement(others, 0, 0.3).lane).toBe(1)
  })

  it('auto arrange keeps every planet and respects order', () => {
    const planets = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, order: i, lane: 5, phase: 0 }) as Planet)
    const out = autoArrange(planets)
    expect(out.size).toBe(9)
    expect(out.get('p0')!.lane).toBe(0)
  })
})

describe('group & task layouts', () => {
  const group = (i: number) => ({ id: `g${i}`, order: i }) as Group
  it('places unlimited groups on growing lanes', () => {
    const { slots, extent } = layoutGroups(Array.from({ length: 30 }, (_, i) => group(i)), 2)
    expect(slots.size).toBe(30)
    expect(extent).toBeGreaterThan(8)
  })

  const task = (id: string, priority: Task['priority'], status: Task['status'] = 'todo'): Task =>
    ({ id, priority, status, dueDate: null, dueTime: null, createdAt: Number(id.replace(/\D/g, '')) || 0 }) as Task

  it('bands by priority, inner = more urgent, done in the outermost archive band', () => {
    const { slots, bands } = layoutTasks([task('1', 'low'), task('2', 'critical'), task('3', 'high', 'done'), task('4', 'medium')])
    expect(slots.get('2')!.radius).toBeLessThan(slots.get('4')!.radius)
    expect(slots.get('4')!.radius).toBeLessThan(slots.get('1')!.radius)
    expect(slots.get('1')!.radius).toBeLessThan(slots.get('3')!.radius)
    expect(bands.map((b) => b.band)).toEqual(['critical', 'medium', 'low', 'done'])
  })

  it('stacks overflowing bands in extra rings without sharing radius+phase', () => {
    const tasks = Array.from({ length: 60 }, (_, i) => task(`${i}`, 'medium'))
    const { slots } = layoutTasks(tasks)
    const seen = new Set<string>()
    for (const s of slots.values()) {
      const key = `${s.radius.toFixed(3)}:${(((s.phase % 6.283185) + 6.283185) % 6.283185).toFixed(3)}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })
})
