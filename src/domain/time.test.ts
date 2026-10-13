import { describe, expect, it } from 'vitest'
import { describeDue, dueTimestamp, urgencyOf } from './time'
import type { Task } from './types'

const base = { status: 'todo' } as Task
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime()

describe('urgency', () => {
  const now = at(2026, 6, 10)
  it('classifies by distance to the deadline', () => {
    expect(urgencyOf({ ...base, dueDate: null, dueTime: null }, now)).toBe(0)
    expect(urgencyOf({ ...base, dueDate: '2026-06-20', dueTime: null }, now)).toBe(0)
    expect(urgencyOf({ ...base, dueDate: '2026-06-12', dueTime: '10:00' }, now)).toBe(1)
    expect(urgencyOf({ ...base, dueDate: '2026-06-10', dueTime: '18:00' }, now)).toBe(2)
    expect(urgencyOf({ ...base, dueDate: '2026-06-09', dueTime: '18:00' }, now)).toBe(3)
  })
  it('ignores completed tasks', () => {
    expect(urgencyOf({ ...base, status: 'done', dueDate: '2020-01-01', dueTime: null }, now)).toBe(0)
  })
  it('a date without time is due at the end of the day', () => {
    const t = dueTimestamp({ dueDate: '2026-06-10', dueTime: null })!
    expect(new Date(t).getHours()).toBe(23)
  })
  it('describes overdue tasks', () => {
    expect(describeDue({ ...base, dueDate: '2026-06-08', dueTime: '12:00' } as Task, now)).toBe('Atrasada há 2 dias')
  })
})
