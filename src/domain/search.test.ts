import { describe, expect, it } from 'vitest'
import { emptyUniverse } from '../state/dataStore'
import { buildSampleUniverse } from '../state/sample'
import { search } from './search'

const data = buildSampleUniverse(emptyUniverse())

describe('global search', () => {
  it('finds tasks ignoring accents and case', () => {
    const hits = search(data, 'relatorio MENSAL')
    expect(hits[0]?.title).toBe('Fechar relatório mensal')
    expect(hits[0]?.kind).toBe('task')
  })
  it('finds planets and groups', () => {
    expect(search(data, 'viag').some((h) => h.kind === 'planet' && h.title === 'Viagens')).toBe(true)
    expect(search(data, 'auditor').some((h) => h.kind === 'group')).toBe(true)
  })
  it('searches notes and subtasks', () => {
    expect(search(data, 'custos filial').some((h) => h.kind === 'task')).toBe(true)
  })
  it('requires every token to match', () => {
    expect(search(data, 'relatorio zzzzqqq')).toHaveLength(0)
  })
  it('returns nothing for an empty query', () => {
    expect(search(data, '  ')).toEqual([])
  })
})
