/**
 * Application commands: the only place where data transitions, navigation,
 * toasts and visual effects are orchestrated together.
 */
import { parseBackup, serializeBackup } from '../data/backup'
import { groupsOfPlanet } from '../domain/stats'
import type { Priority, Settings, Status, Task, UniverseData } from '../domain/types'
import { canUndo, checkpoint, currentData, emptyUniverse, flushNow, mutate, replaceData, undo } from './dataStore'
import * as M from './model'
import { buildSampleUniverse } from './sample'
import {
  askConfirm,
  labFromPlanet,
  levelOf,
  newLabDraft,
  pushToast,
  spawnBurst,
  startFlight,
  uiStore,
  type LabDraft,
  type TaskPanel,
} from './uiStore'

const data = () => currentData()

/* ------------------------------ navigation ------------------------------ */

function announce(text: string) {
  uiStore.set({ announce: text })
}

function describeLocation(): string {
  const s = uiStore.get()
  const d = data()
  const planet = d.planets.find((p) => p.id === s.planetId)
  const group = d.groups.find((g) => g.id === s.groupId)
  const task = d.tasks.find((t) => t.id === s.taskId)
  if (task) return `Tarefa ${task.title}, grupo ${group?.name ?? ''}, planeta ${planet?.name ?? ''}`
  if (group) return `Grupo orbital ${group.name}, planeta ${planet?.name ?? ''}`
  if (planet) return `Planeta ${planet.name}`
  return `Universo ${d.settings.universeName}`
}

function closeTransient() {
  if (typeof document !== 'undefined') document.body.style.cursor = ''
  uiStore.set({ groupDialog: null, groupManager: false, searchOpen: false, outlineOpen: false, hover: null })
}

export function goUniverse() {
  // keep the moons on screen while they fade out instead of popping away
  const leaving = uiStore.get().planetId
  uiStore.set({ planetId: null, groupId: null, taskId: null, taskPanel: null, mode: uiStore.get().mode, peekPlanetId: leaving ?? uiStore.get().peekPlanetId })
  closeTransient()
  startFlight()
  announce(describeLocation())
}

export function goPlanet(id: string) {
  const planet = data().planets.find((p) => p.id === id)
  if (!planet) return
  uiStore.set({ planetId: id, groupId: null, taskId: null, taskPanel: null, mode: 'explore', peekPlanetId: null })
  closeTransient()
  startFlight()
  announce(describeLocation())
}

/**
 * Zooming close to a planet opens its category. Unlike a click there is no "flight": the
 * camera keeps its pose and simply changes what it is orbiting, so nothing jumps.
 */
export function enterPlanetByProximity(id: string) {
  const planet = data().planets.find((p) => p.id === id)
  if (!planet) return
  uiStore.set((s) => ({ planetId: id, groupId: null, taskId: null, taskPanel: null, mode: 'explore', peekPlanetId: null, cameraKeep: true, navSeq: s.navSeq + 1, hover: null }))
  closeTransient()
  announce(describeLocation())
}

/** Zooming far away from an open planet returns to the universe, again without re-framing. */
export function exitPlanetByProximity() {
  const leaving = uiStore.get().planetId
  if (!leaving) return
  uiStore.set((s) => ({ planetId: null, groupId: null, taskId: null, taskPanel: null, peekPlanetId: leaving, cameraKeep: true, navSeq: s.navSeq + 1, hover: null }))
  closeTransient()
  announce(describeLocation())
}

export function goGroup(id: string) {
  const group = data().groups.find((g) => g.id === id)
  if (!group) return
  uiStore.set({ planetId: group.planetId, groupId: id, taskId: null, taskPanel: null, mode: 'explore' })
  closeTransient()
  startFlight(2000)
  announce(describeLocation())
}

export function selectTask(id: string) {
  const task = data().tasks.find((t) => t.id === id)
  if (!task) return
  const prev = uiStore.get()
  uiStore.set({
    planetId: task.planetId,
    groupId: task.groupId,
    taskId: id,
    taskPanel: { mode: 'edit' },
    mode: 'explore',
    settingsOpen: false,
  })
  closeTransient()
  startFlight(prev.groupId === task.groupId ? 1400 : 2200)
  announce(describeLocation())
}

export function deselectTask() {
  const s = uiStore.get()
  if (!s.taskId && !s.taskPanel) return
  uiStore.set({ taskId: null, taskPanel: null })
  startFlight(1200)
  announce(describeLocation())
}

/** Esc: close the innermost thing first, then climb one level. */
export function goBack() {
  const s = uiStore.get()
  if (s.confirm) return uiStore.set({ confirm: null })
  if (s.searchOpen || s.outlineOpen || s.settingsOpen || s.helpOpen || s.groupDialog || s.groupManager) {
    return uiStore.set({ searchOpen: false, outlineOpen: false, settingsOpen: false, helpOpen: false, groupDialog: null, groupManager: false })
  }
  if (s.lab) return cancelLab()
  if (s.mode === 'arrange') return uiStore.set({ mode: 'explore' })
  if (s.taskPanel?.mode === 'new') return uiStore.set({ taskPanel: null })
  switch (levelOf(s)) {
    case 'task':
      return deselectTask()
    case 'group':
      return goPlanet(s.planetId!)
    case 'planet':
      return goUniverse()
    default:
  }
}

export function cycleLocationPlanet(dir: 1 | -1) {
  const planets = [...data().planets].sort((a, b) => a.order - b.order)
  if (planets.length === 0) return
  const s = uiStore.get()
  const i = planets.findIndex((p) => p.id === s.planetId)
  const next = planets[(i < 0 ? (dir > 0 ? 0 : planets.length - 1) : (i + dir + planets.length) % planets.length)]!
  goPlanet(next.id)
}

export function recenter() {
  startFlight(1400)
}

/** Keep navigation valid when data disappears (delete, undo, import, reset). */
export function reconcileNavigation() {
  const s = uiStore.get()
  const d = data()
  if (s.lab?.editingId && !d.planets.some((p) => p.id === s.lab!.editingId)) {
    uiStore.set({ lab: null, planetId: null, groupId: null, taskId: null, taskPanel: null })
    startFlight(1600)
    return
  }
  const planetOk = !s.planetId || d.planets.some((p) => p.id === s.planetId)
  const groupOk = !s.groupId || d.groups.some((g) => g.id === s.groupId)
  const taskOk = !s.taskId || d.tasks.some((t) => t.id === s.taskId)
  if (planetOk && groupOk && taskOk) return
  if (!planetOk) return goUniverse()
  if (!groupOk) return goPlanet(s.planetId!)
  deselectTask()
}

/* --------------------------------- lab ---------------------------------- */

export function openLab(planetId?: string) {
  const s = uiStore.get()
  const planet = planetId ? data().planets.find((p) => p.id === planetId) : undefined
  uiStore.set({
    lab: {
      editingId: planet?.id ?? null,
      draft: planet ? labFromPlanet(planet) : newLabDraft(),
      returnTo: { planetId: s.planetId, groupId: s.groupId, taskId: s.taskId },
    },
    mode: 'explore',
    taskPanel: null,
    settingsOpen: false,
    hover: null,
  })
  closeTransient()
  startFlight(1800)
  announce(planet ? `Laboratório: editando ${planet.name}` : 'Laboratório de formação planetária')
}

export function patchLab(patch: Partial<LabDraft>) {
  const lab = uiStore.get().lab
  if (!lab) return
  uiStore.set({ lab: { ...lab, draft: { ...lab.draft, ...patch } } })
}

export function cancelLab() {
  const lab = uiStore.get().lab
  if (!lab) return
  uiStore.set({
    lab: null,
    planetId: lab.returnTo.planetId,
    groupId: lab.returnTo.groupId,
    taskId: lab.returnTo.taskId,
    taskPanel: lab.returnTo.taskId ? { mode: 'edit' } : null,
  })
  startFlight(1600)
  announce(describeLocation())
}

export function confirmLab(): boolean {
  const lab = uiStore.get().lab
  if (!lab) return false
  const draft = lab.draft
  if (!draft.name.trim()) {
    pushToast('Dê um nome ao planeta antes de formá-lo.', 'warn')
    return false
  }
  if (lab.editingId) {
    mutate((d) => M.editPlanet(d, lab.editingId!, draft))
    uiStore.set({
      lab: null,
      planetId: lab.returnTo.planetId,
      groupId: lab.returnTo.groupId,
      taskId: lab.returnTo.taskId,
      taskPanel: lab.returnTo.taskId ? { mode: 'edit' } : null,
    })
    startFlight(1600)
    pushToast(`“${draft.name.trim()}” atualizado.`, 'success')
    return true
  }
  let createdId = ''
  mutate((d) => {
    const r = M.addPlanet(d, draft)
    createdId = r.id
    return r.data
  })
  uiStore.set({ lab: null, planetId: null, groupId: null, taskId: null, taskPanel: null, forming: { id: createdId, startedAt: performance.now() } })
  startFlight(3200)
  spawnBurst({ kind: 'form', target: { kind: 'planet', id: createdId }, color: draft.style.atmosphere.color })
  announce(`Planeta ${draft.name.trim()} formado`)
  setTimeout(() => {
    const f = uiStore.get().forming
    if (f && f.id === createdId) {
      uiStore.set({ forming: null })
      startFlight(2600)
    }
  }, 4600)
  return true
}

/* -------------------------------- planets ------------------------------- */

export function movePlanet(id: string, lane: number, phase: number) {
  mutate((d) => M.placePlanet(d, id, lane, phase))
}

export function shiftPlanet(id: string, dir: -1 | 1) {
  mutate((d) => M.shiftPlanetOrder(d, id, dir))
}

export function autoArrangePlanets() {
  checkpoint('Reorganização automática')
  mutate((d) => M.arrangePlanets(d))
  pushToast('Planetas redistribuídos pelas órbitas.', 'success', { label: 'Desfazer', run: () => runUndo() })
}

export function requestDeletePlanet(id: string) {
  const d = data()
  const planet = d.planets.find((p) => p.id === id)
  if (!planet) return
  const groups = d.groups.filter((g) => g.planetId === id).length
  const tasks = d.tasks.filter((t) => t.planetId === id).length
  askConfirm({
    title: `Excluir “${planet.name}”?`,
    message:
      groups + tasks === 0
        ? 'O planeta será removido do universo.'
        : `Isso também remove ${groups} grupo${groups === 1 ? '' : 's'} orbita${groups === 1 ? 'l' : 'is'} e ${tasks} tarefa${tasks === 1 ? '' : 's'}. Você poderá desfazer logo em seguida.`,
    confirmLabel: 'Excluir planeta',
    danger: true,
    onConfirm: () => {
      checkpoint(`Planeta “${planet.name}” excluído`)
      mutate((x) => M.removePlanet(x, id))
      reconcileNavigation()
      pushToast(`“${planet.name}” foi excluído.`, 'info', { label: 'Desfazer', run: () => runUndo() }, 9000)
    },
  })
}

/* -------------------------------- groups -------------------------------- */

export function openGroupDialog(dialog: NonNullable<ReturnType<typeof uiStore.get>['groupDialog']>) {
  uiStore.set({ groupDialog: dialog, groupManager: false })
}

export function saveGroup(
  dialog: NonNullable<ReturnType<typeof uiStore.get>['groupDialog']>,
  input: M.GroupInput,
): string | null {
  if (!input.name.trim()) {
    pushToast('O grupo precisa de um nome.', 'warn')
    return null
  }
  if (dialog.mode === 'edit') {
    mutate((d) => M.editGroup(d, dialog.id, input))
    uiStore.set({ groupDialog: null })
    return dialog.id
  }
  let id: string | null = null
  mutate((d) => {
    const r = M.addGroup(d, dialog.planetId, input)
    id = r.id
    return r.data
  })
  uiStore.set({ groupDialog: null })
  if (id) spawnBurst({ kind: 'launch', target: { kind: 'group', id }, color: input.color })
  return id
}

export function shiftGroup(id: string, dir: -1 | 1) {
  mutate((d) => M.shiftGroupOrder(d, id, dir))
}

export function requestDeleteGroup(id: string) {
  const d = data()
  const group = d.groups.find((g) => g.id === id)
  if (!group) return
  const tasks = d.tasks.filter((t) => t.groupId === id).length
  askConfirm({
    title: `Excluir o grupo “${group.name}”?`,
    message: tasks === 0 ? 'O grupo será removido do planeta.' : `As ${tasks} tarefa${tasks === 1 ? '' : 's'} dele também serão removidas. Você poderá desfazer logo em seguida.`,
    confirmLabel: 'Excluir grupo',
    danger: true,
    onConfirm: () => {
      checkpoint(`Grupo “${group.name}” excluído`)
      mutate((x) => M.removeGroup(x, id))
      reconcileNavigation()
      pushToast(`Grupo “${group.name}” excluído.`, 'info', { label: 'Desfazer', run: () => runUndo() }, 9000)
    },
  })
}

/* --------------------------------- tasks -------------------------------- */

export function openNewTask(opts: { planetId?: string; groupId?: string; priority?: Priority } = {}): boolean {
  const s = uiStore.get()
  const d = data()
  if (d.planets.length === 0) {
    pushToast('Forme um planeta e um grupo orbital antes de criar tarefas.', 'warn')
    return false
  }
  const groupId = opts.groupId ?? s.groupId
  const group = d.groups.find((g) => g.id === groupId)
  const planetId = group?.planetId ?? opts.planetId ?? s.planetId ?? [...d.planets].sort((a, b) => a.order - b.order)[0]!.id
  const resolvedGroup = group?.id ?? groupsOfPlanet(d.groups, planetId)[0]?.id ?? null
  const panel: TaskPanel = { mode: 'new', planetId, groupId: resolvedGroup, priority: opts.priority }
  uiStore.set({ taskPanel: panel, settingsOpen: false, searchOpen: false, outlineOpen: false, groupDialog: null, groupManager: false })
  return true
}

export function createTask(input: M.TaskInput): string | null {
  if (!input.title.trim()) {
    pushToast('A tarefa precisa de um título.', 'warn')
    return null
  }
  let id: string | null = null
  mutate((d) => {
    const r = M.addTask(d, input)
    id = r.id
    return r.data
  })
  if (id) {
    spawnBurst({ kind: 'launch', target: { kind: 'task', id }, color: '#e8d9b0' })
    selectTask(id)
  }
  return id
}

export function updateTask(id: string, patch: M.TaskPatch) {
  const before = data().tasks.find((t) => t.id === id)
  mutate((d) => M.patchTask(d, id, patch))
  if (before && patch.status === 'done' && before.status !== 'done') {
    spawnBurst({ kind: 'complete', target: { kind: 'task', id }, color: '#9fe3c8' })
    announce(`Tarefa ${before.title} concluída`)
  }
}

export function setTaskStatus(id: string, status: Status) {
  updateTask(id, { status })
}

export function relocateTask(id: string, groupId: string) {
  mutate((d) => M.moveTask(d, id, groupId))
  const t = data().tasks.find((x) => x.id === id)
  if (t) {
    uiStore.set({ planetId: t.planetId, groupId: t.groupId })
    startFlight(1800)
    pushToast('Tarefa movida.', 'success')
  }
}

export function toggleTaskLink(a: string, b: string, on: boolean) {
  mutate((d) => M.linkTasks(d, a, b, on))
}

export function requestDeleteTask(id: string) {
  const task = data().tasks.find((t) => t.id === id)
  if (!task) return
  askConfirm({
    title: 'Excluir esta tarefa?',
    message: `“${task.title}” será removida. Você poderá desfazer logo em seguida.`,
    confirmLabel: 'Excluir tarefa',
    danger: true,
    onConfirm: () => {
      checkpoint('Tarefa excluída')
      mutate((x) => M.removeTask(x, id))
      reconcileNavigation()
      pushToast('Tarefa excluída.', 'info', { label: 'Desfazer', run: () => runUndo() }, 9000)
    },
  })
}

/* ------------------------------- universe ------------------------------- */

export function updateSettings(patch: Partial<Settings>) {
  mutate((d) => M.patchSettings(d, patch))
}

export function runUndo() {
  if (!canUndo()) return
  const label = undo()
  reconcileNavigation()
  if (label) pushToast(`Desfeito: ${label}.`, 'success')
}

export function loadSampleUniverse() {
  const d = data()
  const doLoad = () => {
    mutate((x) => buildSampleUniverse({ ...x, planets: [], groups: [], tasks: [] }))
    pushToast('Universo de exemplo carregado. Tudo pode ser editado ou excluído.', 'success')
  }
  if (d.planets.length === 0) return doLoad()
  askConfirm({
    title: 'Substituir seu universo pelo exemplo?',
    message: 'Seus planetas, grupos e tarefas atuais serão substituídos. Você poderá desfazer logo em seguida.',
    confirmLabel: 'Substituir',
    danger: true,
    onConfirm: () => {
      checkpoint('Universo substituído pelo exemplo')
      doLoad()
      reconcileNavigation()
    },
  })
}

export function exportBackup(): { filename: string; text: string } {
  const now = new Date()
  const stamp = now.toISOString().slice(0, 10)
  return { filename: `orbita-backup-${stamp}.json`, text: serializeBackup(data(), now) }
}

export async function importBackup(text: string): Promise<boolean> {
  const result = parseBackup(text)
  if (!result.ok) {
    pushToast(result.error, 'error')
    return false
  }
  const incoming = result.data
  const apply = async () => {
    await replaceData(incoming)
    reconcileNavigation()
    pushToast(
      result.dropped > 0 ? `Backup importado. ${result.dropped} registro(s) inválido(s) foram ignorados.` : 'Backup importado com sucesso.',
      result.dropped > 0 ? 'warn' : 'success',
    )
  }
  askConfirm({
    title: 'Importar backup?',
    message: `Isto substitui o universo atual por “${incoming.settings.universeName}” (${incoming.planets.length} planetas, ${incoming.tasks.length} tarefas).`,
    confirmLabel: 'Importar e substituir',
    danger: true,
    onConfirm: () => void apply(),
  })
  return true
}

export function requestResetUniverse() {
  askConfirm({
    title: 'Apagar todo o universo?',
    message: 'Todos os planetas, grupos, tarefas e configurações serão apagados deste navegador. Exporte um backup antes se quiser guardar uma cópia.',
    confirmLabel: 'Apagar tudo',
    danger: true,
    onConfirm: () => {
      void replaceData(emptyUniverse()).then(() => {
        reconcileNavigation()
        pushToast('Universo reiniciado.', 'info')
      })
    },
  })
}

export async function flushPending() {
  await flushNow()
}

export type { UniverseData, Task }
