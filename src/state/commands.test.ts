import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../data/memory'
import { defaultStyle } from '../domain/presets'
import * as C from './commands'
import { collectFiles, currentData, dataStore, initData, readAllFiles, readFile } from './dataStore'
import { uiStore } from './uiStore'

async function fresh() {
  uiStore.set({ planetId: null, groupId: null, taskId: null, taskPanel: null, lab: null, confirm: null, toasts: [], forming: null, searchOpen: false, settingsOpen: false, outlineOpen: false, helpOpen: false, groupDialog: null, groupManager: false })
  await initData(new MemoryAdapter())
}

/** create planet → group → task through the same commands the UI uses */
function seed() {
  C.openLab()
  C.patchLab({ name: 'SEP', symbol: '⚙', style: { ...defaultStyle(), surface: 'gas' } })
  expect(C.confirmLab()).toBe(true)
  const planet = currentData().planets[0]!
  C.openGroupDialog({ mode: 'new', planetId: planet.id })
  const groupId = C.saveGroup({ mode: 'new', planetId: planet.id }, { name: 'Auditorias', color: '#ffffff', kind: 'auto' })!
  const taskId = C.createTask({ groupId, title: 'Auditar compras', priority: 'high', dueDate: '2030-01-01' })!
  return { planet, groupId, taskId }
}

const confirmPending = () => {
  const req = uiStore.get().confirm
  expect(req).not.toBeNull()
  req!.onConfirm()
  uiStore.set({ confirm: null })
}

describe('commands', () => {
  beforeEach(fresh)

  it('lab → planet is really created and flagged for the formation animation', () => {
    C.openLab()
    C.patchLab({ name: '  ' })
    expect(C.confirmLab()).toBe(false) // a name is required
    expect(currentData().planets).toHaveLength(0)
    C.patchLab({ name: 'Clientes' })
    expect(C.confirmLab()).toBe(true)
    expect(currentData().planets.map((p) => p.name)).toEqual(['Clientes'])
    expect(uiStore.get().lab).toBeNull()
    expect(uiStore.get().forming?.id).toBe(currentData().planets[0]!.id)
  })

  it('editing a planet through the lab keeps its identity and position', () => {
    const { planet } = seed()
    C.openLab(planet.id)
    expect(uiStore.get().lab?.draft.name).toBe('SEP')
    C.patchLab({ name: 'SEP 2' })
    C.confirmLab()
    const after = currentData().planets[0]!
    expect(after.id).toBe(planet.id)
    expect(after.name).toBe('SEP 2')
    expect([after.lane, after.phase]).toEqual([planet.lane, planet.phase])
  })

  it('navigates universe → planet → group → task and back with Esc semantics', () => {
    const { planet, groupId, taskId } = seed()
    C.goPlanet(planet.id)
    C.goGroup(groupId)
    C.selectTask(taskId)
    expect(uiStore.get()).toMatchObject({ planetId: planet.id, groupId, taskId })
    C.goBack()
    expect(uiStore.get().taskId).toBeNull()
    expect(uiStore.get().groupId).toBe(groupId)
    C.goBack()
    expect(uiStore.get().groupId).toBeNull()
    C.goBack()
    expect(uiStore.get().planetId).toBeNull()
  })

  it('completing a task stamps the completion date and spawns the burst', () => {
    const { taskId } = seed()
    C.setTaskStatus(taskId, 'done')
    const t = currentData().tasks[0]!
    expect(t.status).toBe('done')
    expect(t.completedAt).toBeTypeOf('number')
    expect(uiStore.get().bursts.some((b) => b.kind === 'complete')).toBe(true)
  })

  it('delete asks for confirmation and can be undone', () => {
    const { taskId } = seed()
    C.requestDeleteTask(taskId)
    expect(currentData().tasks).toHaveLength(1) // not yet
    confirmPending()
    expect(currentData().tasks).toHaveLength(0)
    expect(uiStore.get().toasts.some((t) => t.action?.label === 'Desfazer')).toBe(true)
    C.runUndo()
    expect(currentData().tasks).toHaveLength(1)
  })

  it('deleting a planet cascades and undo restores everything', () => {
    const { planet } = seed()
    C.requestDeletePlanet(planet.id)
    expect(uiStore.get().confirm?.message).toMatch(/1 grupo/)
    confirmPending()
    expect(currentData()).toMatchObject({ planets: [], groups: [], tasks: [] })
    C.runUndo()
    expect(currentData().planets).toHaveLength(1)
    expect(currentData().groups).toHaveLength(1)
    expect(currentData().tasks).toHaveLength(1)
  })

  it('navigation self-heals when the current location disappears', () => {
    const { planet, groupId } = seed()
    C.goGroup(groupId)
    C.requestDeletePlanet(planet.id)
    confirmPending()
    expect(uiStore.get().planetId).toBeNull()
    expect(uiStore.get().groupId).toBeNull()
  })

  it('moving a task to a group of another planet updates both ids', () => {
    const { groupId, taskId } = seed()
    C.openLab()
    C.patchLab({ name: 'Viagens' })
    C.confirmLab()
    const viagens = currentData().planets.find((p) => p.name === 'Viagens')!
    const g2 = C.saveGroup({ mode: 'new', planetId: viagens.id }, { name: 'Roteiro', color: '#fff', kind: 'moon' })!
    C.relocateTask(taskId, g2)
    const t = currentData().tasks[0]!
    expect(t).toMatchObject({ groupId: g2, planetId: viagens.id })
    expect(t.groupId).not.toBe(groupId)
  })

  it('refuses to create tasks without a title and group dialogs without a name', () => {
    const { planet, groupId } = seed()
    expect(C.createTask({ groupId, title: '   ' })).toBeNull()
    expect(C.saveGroup({ mode: 'new', planetId: planet.id }, { name: '', color: '#fff', kind: 'auto' })).toBeNull()
  })

  it('imports a backup after confirmation and rejects invalid files', async () => {
    seed()
    const { text } = await C.exportBackup()
    await fresh()
    expect(await C.importBackup('{ nope')).toBe(false)
    expect(currentData().planets).toHaveLength(0)
    expect(await C.importBackup(text)).toBe(true)
    confirmPending()
    await new Promise((r) => setTimeout(r, 10))
    expect(currentData().planets.map((p) => p.name)).toEqual(['SEP'])
    expect(currentData().tasks).toHaveLength(1)
  })

  it('settings changes are persisted into the data store', () => {
    C.updateSettings({ universeName: '  Cosmos  ', effects: 'minimal', orbitSpeed: 0.5 })
    expect(dataStore.get().data.settings).toMatchObject({ universeName: 'Cosmos', effects: 'minimal', orbitSpeed: 0.5 })
  })

  it('loading the sample universe on an empty one needs no confirmation', () => {
    C.loadSampleUniverse()
    expect(uiStore.get().confirm).toBeNull()
    expect(currentData().planets.length).toBeGreaterThan(2)
  })

  describe('attachments', () => {
    const file = (name: string, bytes: number[] | number, type = '') => new File([new Uint8Array(typeof bytes === 'number' ? new Array(bytes).fill(7) : bytes)], name, { type })

    it('stores the bytes locally and lists the file on the task', async () => {
      const { taskId } = seed()
      expect(await C.attachFiles(taskId, [file('laudo.pdf', [1, 2, 3, 4], 'application/pdf'), file('foto.png', [9, 9], 'image/png')])).toBe(2)
      const task = currentData().tasks.find((t) => t.id === taskId)!
      expect(task.attachments.map((a) => [a.name, a.size, a.type])).toEqual([
        ['laudo.pdf', 4, 'application/pdf'],
        ['foto.png', 2, 'image/png'],
      ])
      const stored = await readFile(task.attachments[0]!.id)
      expect([...new Uint8Array(stored!.data)]).toEqual([1, 2, 3, 4])
      expect(stored!.taskId).toBe(taskId)
    })

    it('rejects empty and oversized files without touching the task', async () => {
      const { taskId } = seed()
      const big = { name: 'enorme.zip', size: 26 * 1024 * 1024, type: '', arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File
      expect(await C.attachFiles(taskId, [file('vazio.txt', 0), big])).toBe(0)
      expect(currentData().tasks[0]!.attachments).toHaveLength(0)
      expect(uiStore.get().toasts.some((t) => t.tone === 'warn')).toBe(true)
    })

    it('removing an attachment can be undone and its bytes are only collected once nothing can bring it back', async () => {
      const { taskId } = seed()
      await C.attachFiles(taskId, [file('a.xlsx', [5, 5, 5])])
      const id = currentData().tasks[0]!.attachments[0]!.id
      C.requestRemoveAttachment(taskId, id)
      confirmPending()
      expect(currentData().tasks[0]!.attachments).toHaveLength(0)
      await collectFiles()
      expect(await readFile(id)).toBeDefined() // still reachable through undo
      C.runUndo()
      expect(currentData().tasks[0]!.attachments.map((a) => a.id)).toEqual([id])
      expect(await readFile(id)).toBeDefined()
    })

    it('collects files of deleted tasks once the undo history no longer needs them', async () => {
      const { taskId } = seed()
      await C.attachFiles(taskId, [file('b.docx', [1])])
      const id = currentData().tasks[0]!.attachments[0]!.id
      C.requestDeleteTask(taskId)
      confirmPending()
      await collectFiles()
      expect(await readFile(id)).toBeDefined()
      // a fresh session has no undo history
      const adapter = new MemoryAdapter()
      await adapter.putFile({ id, taskId, name: 'b.docx', type: '', size: 1, addedAt: 1, data: new Uint8Array([1]).buffer })
      await initData(adapter) // loads an empty universe and collects the orphan
      await new Promise((r) => setTimeout(r, 10))
      expect(await adapter.listFileIds()).toEqual([])
    })

    it('goes into the backup and comes back with the restore', async () => {
      const { taskId } = seed()
      await C.attachFiles(taskId, [file('plano.pdf', [10, 20, 30], 'application/pdf')])
      const { text } = await C.exportBackup()
      expect(JSON.parse(text).files).toHaveLength(1)
      await fresh()
      expect(await readAllFiles()).toHaveLength(0)
      expect(await C.importBackup(text)).toBe(true)
      confirmPending()
      await new Promise((r) => setTimeout(r, 20))
      const task = currentData().tasks[0]!
      expect(task.attachments).toHaveLength(1)
      const back = await readFile(task.attachments[0]!.id)
      expect([...new Uint8Array(back!.data)]).toEqual([10, 20, 30])
      expect(back!.name).toBe('plano.pdf')
    })
  })
})
