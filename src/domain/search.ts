import type { UniverseData } from './types'

export type SearchKind = 'planet' | 'group' | 'task'

export interface SearchHit {
  kind: SearchKind
  id: string
  title: string
  subtitle: string
  color: string
  symbol: string
  score: number
}

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

function scoreText(haystack: string, tokens: string[]): number {
  let score = 0
  for (const t of tokens) {
    const i = haystack.indexOf(t)
    if (i < 0) return 0
    score += i === 0 ? 3 : haystack[i - 1] === ' ' ? 2 : 1
  }
  return score
}

/** Global search over planets, groups, tasks (title, description, subtasks, notes). */
export function search(data: UniverseData, query: string, limit = 40): SearchHit[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const hits: SearchHit[] = []
  const planetOf = new Map(data.planets.map((p) => [p.id, p]))
  const groupOf = new Map(data.groups.map((g) => [g.id, g]))

  for (const p of data.planets) {
    const s = scoreText(normalize(`${p.name} ${p.description}`), tokens)
    if (s) hits.push({ kind: 'planet', id: p.id, title: p.name, subtitle: 'Planeta', color: p.style.colors.primary, symbol: p.symbol, score: s * 3 })
  }
  for (const g of data.groups) {
    const s = scoreText(normalize(`${g.name} ${g.description}`), tokens)
    if (s) hits.push({ kind: 'group', id: g.id, title: g.name, subtitle: `Grupo · ${planetOf.get(g.planetId)?.name ?? ''}`, color: g.color, symbol: g.symbol || '●', score: s * 2 })
  }
  for (const t of data.tasks) {
    const titleScore = scoreText(normalize(t.title), tokens)
    const bodyScore = titleScore ? 0 : scoreText(normalize(`${t.description} ${t.subtasks.map((s) => s.title).join(' ')} ${t.notes.map((n) => n.text).join(' ')}`), tokens)
    const s = titleScore * 2 + bodyScore
    if (!s) continue
    const g = groupOf.get(t.groupId)
    const p = planetOf.get(t.planetId)
    hits.push({
      kind: 'task',
      id: t.id,
      title: t.title,
      subtitle: `Tarefa · ${p?.name ?? ''} › ${g?.name ?? ''}${t.status === 'done' ? ' · concluída' : ''}`,
      color: p?.style.colors.primary ?? '#888',
      symbol: '◦',
      score: s,
    })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
