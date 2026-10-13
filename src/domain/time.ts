import type { Task } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function toTimeInput(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** epoch ms → value for <input type="datetime-local"> */
export function toDateTimeLocal(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  return `${toDateInput(d)}T${toTimeInput(d)}`
}

export function fromDateTimeLocal(v: string): number | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Deadline in epoch ms. A date without time is due at the end of that day. */
export function dueTimestamp(task: Pick<Task, 'dueDate' | 'dueTime'>): number | null {
  if (!task.dueDate) return null
  const [y, m, d] = task.dueDate.split('-').map(Number)
  if (!y || !m || !d) return null
  const [hh, mm] = task.dueTime ? task.dueTime.split(':').map(Number) : [23, 59]
  const t = new Date(y, m - 1, d, hh ?? 23, mm ?? 59, task.dueTime ? 0 : 59).getTime()
  return Number.isFinite(t) ? t : null
}

/** 0 none · 1 approaching (<72h) · 2 imminent (<24h) · 3 overdue */
export type Urgency = 0 | 1 | 2 | 3

const HOUR = 3_600_000

export function urgencyOf(task: Task, now: number): Urgency {
  if (task.status === 'done') return 0
  const due = dueTimestamp(task)
  if (due == null) return 0
  const left = due - now
  if (left < 0) return 3
  if (left < 24 * HOUR) return 2
  if (left < 72 * HOUR) return 1
  return 0
}

export function describeDue(task: Task, now: number): string | null {
  const due = dueTimestamp(task)
  if (due == null) return null
  const left = due - now
  const abs = Math.abs(left)
  const days = Math.floor(abs / (24 * HOUR))
  const hours = Math.floor(abs / HOUR)
  const mins = Math.max(1, Math.floor(abs / 60_000))
  const span = days >= 1 ? `${days} dia${days > 1 ? 's' : ''}` : hours >= 1 ? `${hours} h` : `${mins} min`
  return left < 0 ? `Atrasada há ${span}` : `Vence em ${span}`
}

export function formatDue(task: Pick<Task, 'dueDate' | 'dueTime'>): string {
  if (!task.dueDate) return 'Sem prazo'
  const [y, m, d] = task.dueDate.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  const base = date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
  return task.dueTime ? `${base} · ${task.dueTime}` : base
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
