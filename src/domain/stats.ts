import type { Group, Planet, Task } from './types'
import { urgencyOf, type Urgency } from './time'

export interface Stats {
  total: number
  done: number
  doing: number
  blocked: number
  open: number
  /** 0..1, 0 when there are no tasks */
  progress: number
  /** worst urgency among open tasks */
  urgency: Urgency
  /** number of open tasks with urgency >= 2 */
  urgentCount: number
  overdueCount: number
}

export function statsOf(tasks: Task[], now: number): Stats {
  let done = 0
  let doing = 0
  let blocked = 0
  let urgency: Urgency = 0
  let urgentCount = 0
  let overdueCount = 0
  for (const t of tasks) {
    if (t.status === 'done') done++
    else if (t.status === 'doing') doing++
    else if (t.status === 'blocked') blocked++
    const u = urgencyOf(t, now)
    if (u > urgency) urgency = u
    if (u >= 2) urgentCount++
    if (u === 3) overdueCount++
  }
  const total = tasks.length
  return {
    total,
    done,
    doing,
    blocked,
    open: total - done,
    progress: total === 0 ? 0 : done / total,
    urgency,
    urgentCount,
    overdueCount,
  }
}

export function subtaskProgress(task: Task): number {
  if (task.subtasks.length === 0) return task.status === 'done' ? 1 : 0
  return task.subtasks.filter((s) => s.done).length / task.subtasks.length
}

export function tasksOfPlanet(tasks: Task[], planetId: string): Task[] {
  return tasks.filter((t) => t.planetId === planetId)
}

export function tasksOfGroup(tasks: Task[], groupId: string): Task[] {
  return tasks.filter((t) => t.groupId === groupId)
}

export function groupsOfPlanet(groups: Group[], planetId: string): Group[] {
  return groups.filter((g) => g.planetId === planetId).sort((a, b) => a.order - b.order)
}

export function sortedPlanets(planets: Planet[]): Planet[] {
  return [...planets].sort((a, b) => a.order - b.order)
}

/** a group is rendered as a station when it has many tasks in progress */
export function groupVisualKind(group: Group, stats: Stats): 'moon' | 'station' | 'asteroid' {
  if (group.kind === 'auto') return stats.doing >= 3 ? 'station' : 'moon'
  return group.kind
}
