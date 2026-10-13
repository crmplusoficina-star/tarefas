import { toDateInput } from '../domain/time'
import { MIX_PRESETS, PALETTES } from '../domain/presets'
import type { PlanetStyle, UniverseData } from '../domain/types'
import { addGroup, addPlanet, addTask, linkTasks, newNote, newSubtask, patchTask } from './model'

const DAY = 86_400_000

function style(partial: Partial<PlanetStyle> & Pick<PlanetStyle, 'surface'>, paletteIdx: number, seed: number): PlanetStyle {
  const pal = PALETTES[paletteIdx]!
  return {
    colors: { primary: pal.primary, secondary: pal.secondary, accent: pal.accent },
    detail: 0.5,
    turbulence: 0.5,
    coverage: 0.5,
    mix: { ...MIX_PRESETS[partial.surface] },
    atmosphere: { kind: 'haze', color: pal.atmosphere, intensity: 0.7 },
    size: 1,
    seed,
    tilt: 0.3,
    ...partial,
  }
}

const dueIn = (now: number, days: number) => toDateInput(new Date(now + days * DAY))

/**
 * A small, fully editable demo universe. Nothing here is special-cased by the app:
 * every planet, group and task is ordinary data the user can rename or delete.
 */
export function buildSampleUniverse(base: UniverseData, now = Date.now()): UniverseData {
  let d = base
  const planets = [
    { name: 'Trabalho', description: 'Rotina profissional e entregas.', symbol: '⚙', style: style({ surface: 'tech', coverage: 0.6, atmosphere: { kind: 'halo', color: '#8fc7ff', intensity: 0.8 } }, 7, 11) },
    { name: 'Viagens', description: 'Planejamento de roteiros e reservas.', symbol: '✈', style: style({ surface: 'ocean', coverage: 0.55, atmosphere: { kind: 'clouds', color: '#7cc4ee', intensity: 0.8 }, tilt: 0.45 }, 1, 23) },
    { name: 'Estudos', description: 'Cursos, leituras e certificações.', symbol: '✎', style: style({ surface: 'gas', coverage: 0.65, turbulence: 0.6, atmosphere: { kind: 'storm', color: '#e8a070', intensity: 0.7 } }, 6, 37) },
    { name: 'Casa', description: 'Manutenção e organização doméstica.', symbol: '⌂', style: style({ surface: 'rocky', coverage: 0.7, atmosphere: { kind: 'aurora', color: '#8fe0b0', intensity: 0.75 } }, 2, 53) },
  ]
  const ids: string[] = []
  for (const p of planets) {
    const r = addPlanet(d, p, now)
    d = r.data
    ids.push(r.id)
  }
  const mk = (planetIdx: number, name: string, color: string, kind: 'auto' | 'moon' | 'station' | 'asteroid' = 'auto') => {
    const r = addGroup(d, ids[planetIdx]!, { name, color, kind }, now)
    d = r.data
    return r.id!
  }
  const g = {
    reports: mk(0, 'Relatórios', '#8fb8d8'),
    meetings: mk(0, 'Reuniões', '#d8b48a'),
    audits: mk(0, 'Auditorias', '#b9a3e0', 'station'),
    flights: mk(1, 'Passagens e hospedagem', '#7fd0cf'),
    route: mk(1, 'Roteiro', '#e8c46a'),
    courses: mk(2, 'Cursos', '#d89fb0'),
    reading: mk(2, 'Leituras', '#9fd0b0', 'asteroid'),
    repairs: mk(3, 'Reparos', '#e09a78'),
  }
  const t = (groupId: string, input: Omit<Parameters<typeof addTask>[1], 'groupId'>) => {
    const r = addTask(d, { ...input, groupId }, now)
    d = r.data
    return r.id!
  }
  const a = t(g.reports, { title: 'Fechar relatório mensal', description: 'Consolidar números e revisar com a gestão.', priority: 'critical', status: 'doing', dueDate: dueIn(now, -1), dueTime: '18:00', subtasks: [newSubtask('Levantar dados'), { ...newSubtask('Montar gráficos'), done: true }, newSubtask('Revisão final')] })
  const b = t(g.reports, { title: 'Enviar prévia para a diretoria', priority: 'high', status: 'todo', dueDate: dueIn(now, 0), dueTime: '17:30' })
  t(g.reports, { title: 'Arquivar versões anteriores', priority: 'low', status: 'todo' })
  t(g.reports, { title: 'Atualizar painel de indicadores', priority: 'medium', status: 'doing', dueDate: dueIn(now, 4) })
  t(g.meetings, { title: 'Alinhamento semanal', priority: 'medium', status: 'doing', dueDate: dueIn(now, 1), dueTime: '09:00' })
  t(g.meetings, { title: 'Preparar pauta da reunião trimestral', priority: 'high', status: 'todo', dueDate: dueIn(now, 6) })
  t(g.audits, { title: 'Checklist de conformidade', priority: 'high', status: 'doing', dueDate: dueIn(now, 2) })
  t(g.audits, { title: 'Corrigir não conformidade #14', priority: 'critical', status: 'doing', dueDate: dueIn(now, 1), dueTime: '12:00' })
  t(g.audits, { title: 'Evidências do trimestre', priority: 'medium', status: 'doing', dueDate: dueIn(now, 9) })
  t(g.audits, { title: 'Reunião de encerramento', priority: 'low', status: 'blocked' })
  const c = t(g.flights, { title: 'Reservar voos', priority: 'high', status: 'doing', dueDate: dueIn(now, 3), subtasks: [{ ...newSubtask('Comparar tarifas'), done: true }, newSubtask('Confirmar datas'), newSubtask('Emitir bilhetes')] })
  const e = t(g.flights, { title: 'Escolher hospedagem', priority: 'medium', status: 'todo', dueDate: dueIn(now, 8) })
  t(g.route, { title: 'Montar roteiro de 5 dias', priority: 'medium', status: 'todo' })
  t(g.route, { title: 'Pesquisar restaurantes', priority: 'low', status: 'todo' })
  t(g.courses, { title: 'Módulo 3 — Análise de dados', priority: 'high', status: 'doing', dueDate: dueIn(now, 5), subtasks: [{ ...newSubtask('Vídeos'), done: true }, { ...newSubtask('Exercícios'), done: true }, newSubtask('Prova')] })
  const done = t(g.courses, { title: 'Inscrição na certificação', priority: 'medium', status: 'done' })
  t(g.reading, { title: 'Ler capítulo sobre estratégia', priority: 'low', status: 'todo' })
  t(g.repairs, { title: 'Trocar lâmpadas da sala', priority: 'low', status: 'todo' })
  t(g.repairs, { title: 'Chamar o técnico do ar-condicionado', priority: 'medium', status: 'todo', dueDate: dueIn(now, 2) })

  d = linkTasks(d, a, b, true, now)
  d = linkTasks(d, c, e, true, now)
  d = patchTask(d, a, { notes: [newNote('Falta o dado de custos da filial.', now - DAY / 2)] }, now)
  d = patchTask(d, done, { completedAt: now - 2 * DAY }, now)
  return d
}
