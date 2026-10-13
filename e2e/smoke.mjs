/**
 * End-to-end smoke test: drives the real app in Chromium and checks the success criteria
 * (create planet → groups → tasks → edit/complete → move → delete/undo → reload & persistence).
 *
 *   npm run dev            # in one terminal
 *   npm run e2e            # in another (needs `playwright` resolvable; see PLAYWRIGHT_PATH)
 *
 * Software WebGL (SwiftShader) is used so it also runs on machines without a GPU.
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)
  for (const c of candidates) {
    try {
      return require(c)
    } catch {
      /* try next */
    }
  }
  throw new Error('Playwright não encontrado. Instale com `npm i -D playwright` ou defina PLAYWRIGHT_PATH.')
}
const { chromium } = loadPlaywright()

const BASE = process.env.ORBITA_URL ?? 'http://127.0.0.1:5173/'
const SHOTS = new URL('./shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 760 } })
const page = await context.newPage()
const problems = []
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`)
})

let step = 0
const results = []
async function check(name, fn) {
  step++
  const t0 = Date.now()
  try {
    await fn()
    results.push({ ok: true, name })
    console.log(`  ✓ ${String(step).padStart(2, '0')} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  } catch (e) {
    results.push({ ok: false, name, error: e.message })
    console.log(`  ✗ ${String(step).padStart(2, '0')} ${name}\n      ${e.message.split('\n')[0]}`)
    await page.screenshot({ path: `${SHOTS}fail-${step}.png` }).catch(() => {})
  }
}
const shot = (n) => page.screenshot({ path: `${SHOTS}${n}.png` })
const idb = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('orbita')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const out = {}
          const tx = db.transaction(['planets', 'groups', 'tasks', 'meta'], 'readonly')
          let pending = 4
          for (const s of ['planets', 'groups', 'tasks', 'meta']) {
            const r = tx.objectStore(s).getAll()
            r.onsuccess = () => {
              out[s] = r.result
              if (--pending === 0) resolve(out)
            }
          }
        }
      }),
  )
const eventually = async (fn, ms = 20000, what = 'condição') => {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`Tempo esgotado esperando: ${what}${last ? ` (${last.message})` : ''}`)
}
const label = (kind, name) => page.getByRole('button', { name: `${kind} ${name}` })
const click = (loc) => loc.dispatchEvent('click') // labels drift with the orbits: skip Playwright's stability wait

console.log(`ÓRBITA e2e → ${BASE}`)
await page.goto(BASE)

await check('abre vazio, com convite para formar o primeiro planeta', async () => {
  await page.getByTestId('empty-universe').waitFor({ timeout: 30000 })
})

await check('fixa efeitos "Equilibrado" nas configurações (e salva)', async () => {
  await page.getByTestId('settings-btn').click()
  await page.getByRole('button', { name: 'Equilibrado' }).click()
  await page.getByRole('textbox', { name: 'Nome do universo' }).fill('Cosmos Tracbel')
  await page.getByRole('textbox', { name: 'Nome do universo' }).press('Enter')
  await page.getByRole('button', { name: 'Concluir' }).click()
  await eventually(async () => (await idb()).meta.some((m) => m.value?.universeName === 'Cosmos Tracbel' && m.value?.effects === 'balanced'), 8000, 'configurações salvas')
})

await check('laboratório: cria o planeta "SEP" gasoso com aurora', async () => {
  await page.getByRole('button', { name: /Formar o primeiro planeta/ }).click()
  await page.getByTestId('planet-lab').waitFor()
  await page.getByTestId('lab-name').fill('SEP')
  await page.getByLabel('Descrição').first().fill('Sistema de excelência de processos')
  await page.getByRole('button', { name: 'Símbolo ⚙' }).click()
  await page.getByRole('button', { name: /^Gasoso/ }).click()
  await page.getByRole('button', { name: 'Aurora' }).click()
  await page.waitForTimeout(2500)
  await shot('01-lab')
  await page.getByTestId('lab-confirm').click()
  await eventually(async () => (await idb()).planets.length === 1, 10000, 'planeta salvo no IndexedDB')
  const [p] = (await idb()).planets
  if (p.name !== 'SEP' || p.style.surface !== 'gas' || p.style.atmosphere.kind !== 'aurora' || p.symbol !== '⚙') throw new Error(`planeta salvo incorreto: ${JSON.stringify(p).slice(0, 200)}`)
})

await check('animação de formação e planeta no dock', async () => {
  await page.waitForTimeout(2200)
  await shot('02-forming')
  await page.getByRole('button', { name: /Ir para SEP/ }).waitFor()
})

await check('cria um segundo planeta pelo teclado (N), sem limite artificial', async () => {
  await page.keyboard.press('n')
  await page.getByTestId('lab-name').fill('Viagens')
  await page.getByRole('button', { name: /^Oceânico/ }).click()
  await page.getByTestId('lab-confirm').click()
  await eventually(async () => (await idb()).planets.length === 2, 10000, '2 planetas')
  await page.waitForTimeout(5200)
})

await check('entra no planeta SEP (câmera viaja) e cria grupos orbitais', async () => {
  await page.getByRole('button', { name: /Ir para SEP/ }).click()
  await page.getByRole('button', { name: /Grupo orbital/ }).waitFor()
  await page.getByTestId('empty-planet').waitFor()
  for (const name of ['Auditorias', 'Não Conformidades', 'Relatórios']) {
    await page.keyboard.press('g')
    await page.getByTestId('group-name').fill(name)
    await page.getByTestId('group-save').click()
    // creating a group flies into it: go back to the planet for the next one
    await eventually(async () => (await idb()).groups.some((g) => g.name === name), 8000, `grupo ${name}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
  const groups = (await idb()).groups
  if (groups.length !== 3) throw new Error(`esperava 3 grupos, há ${groups.length}`)
  await page.waitForTimeout(3500)
  await shot('03-planet')
})

await check('entra em um grupo e lança tarefas com todos os campos', async () => {
  await click(label('Grupo', 'Auditorias'))
  await page.getByTestId('empty-group').waitFor()
  await page.keyboard.press('t')
  await page.getByTestId('task-title').fill('Auditar processo de compras')
  await page.getByRole('button', { name: 'Crítica' }).click()
  await page.getByRole('button', { name: 'Em órbita' }).click()
  await page.getByTestId('task-due-date').fill('2020-01-02')
  await page.getByTestId('task-due-time').fill('14:30')
  await page.getByLabel('Descrição').first().fill('Revisar notas fiscais do trimestre')
  await page.getByTestId('subtask-input').fill('Levantar amostra')
  await page.keyboard.press('Enter')
  await page.getByTestId('subtask-input').fill('Emitir relatório')
  await page.keyboard.press('Enter')
  await page.getByTestId('note-input').fill('Falta acesso ao ERP')
  await page.getByRole('button', { name: 'Adicionar observação' }).click()
  await page.getByTestId('task-create').click()
  await eventually(async () => (await idb()).tasks.length === 1, 8000, 'tarefa salva')
  const [t] = (await idb()).tasks
  if (t.priority !== 'critical' || t.status !== 'doing' || t.dueDate !== '2020-01-02' || t.dueTime !== '14:30') throw new Error(`campos incorretos: ${JSON.stringify(t).slice(0, 300)}`)
  if (t.subtasks.length !== 2 || t.notes.length !== 1 || t.description !== 'Revisar notas fiscais do trimestre') throw new Error('subtarefas/observações/descrição não salvas')
  await page.waitForTimeout(3500)
  await shot('04-task-selected')
})

await check('cria mais duas tarefas, conecta duas delas e vê as conexões', async () => {
  for (const [title, prio] of [['Conferir contratos', 'Alta'], ['Arquivar evidências', 'Baixa']]) {
    await page.keyboard.press('Escape') // deselect → group level
    await page.waitForTimeout(300)
    await page.keyboard.press('t')
    await page.getByTestId('task-title').fill(title)
    await page.getByRole('button', { name: prio, exact: true }).click()
    await page.getByTestId('task-create').click()
    await eventually(async () => (await idb()).tasks.some((t) => t.title === title), 8000, title)
  }
  // connect "Arquivar evidências" with "Conferir contratos" from the panel that is open
  await page.getByLabel('Conectar a outra tarefa do grupo').selectOption({ label: 'Conferir contratos' })
  await eventually(async () => (await idb()).tasks.filter((t) => t.links.length === 1).length === 2, 8000, 'conexão simétrica')
})

await check('edita título, conclui (data de conclusão registrada) e reabre', async () => {
  const title = page.getByRole('textbox', { name: 'Título da tarefa' })
  await title.fill('Arquivar evidências do trimestre')
  await title.press('Enter')
  await eventually(async () => (await idb()).tasks.some((t) => t.title === 'Arquivar evidências do trimestre'), 8000, 'título editado')
  await page.getByTestId('task-complete').click()
  await eventually(async () => (await idb()).tasks.find((t) => t.title.startsWith('Arquivar'))?.status === 'done', 8000, 'status done')
  const done = (await idb()).tasks.find((t) => t.title.startsWith('Arquivar'))
  if (!done.completedAt) throw new Error('completedAt ausente')
  await page.waitForTimeout(1500)
  await shot('05-completed')
  await page.getByRole('button', { name: 'Reabrir' }).first().click()
  await eventually(async () => (await idb()).tasks.find((t) => t.title.startsWith('Arquivar'))?.completedAt === null, 8000, 'reaberta')
})

await check('move a tarefa para outro grupo (conexões antigas são desfeitas)', async () => {
  await page.getByTestId('task-group').selectOption({ label: 'Relatórios' })
  const groups = (await idb()).groups
  const rel = groups.find((g) => g.name === 'Relatórios')
  await eventually(async () => {
    const t = (await idb()).tasks.find((x) => x.title.startsWith('Arquivar'))
    return t.groupId === rel.id && t.links.length === 0
  }, 8000, 'tarefa movida')
})

await check('exclui com confirmação e desfaz', async () => {
  await page.getByTestId('task-delete').click()
  await page.getByTestId('confirm-ok').click()
  await eventually(async () => (await idb()).tasks.length === 2, 8000, 'excluída')
  await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click()
  await eventually(async () => (await idb()).tasks.length === 3, 8000, 'restaurada')
})

await check('busca global encontra a tarefa e navega até ela', async () => {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await page.getByTestId('search-input').fill('contratos')
  await page.getByTestId('search-result').first().waitFor()
  await page.keyboard.press('Enter')
  await page.getByTestId('task-panel').waitFor()
  const val = await page.getByRole('textbox', { name: 'Título da tarefa' }).inputValue()
  if (val !== 'Conferir contratos') throw new Error(`abriu "${val}"`)
})

await check('modo reorganizar: arrasta um planeta para outra órbita', async () => {
  await page.keyboard.press('Escape')
  await page.keyboard.press('0')
  await page.waitForTimeout(3500)
  const before = (await idb()).planets.find((p) => p.name === 'Viagens')
  await page.keyboard.press('r')
  await page.waitForTimeout(800)
  // where is the planet on screen right now? (dev builds expose the scene runtime as window.__orbita)
  const at = await page.evaluate((id) => {
    const r = window.__orbita.runtime
    const v = r.pos.get(`p:${id}`).clone().project(r.camera)
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height }
  }, before.id)
  await page.mouse.move(at.x, at.y)
  await page.waitForTimeout(400)
  await page.mouse.down()
  await page.mouse.move(at.x + 150, at.y - 120, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(1200)
  await page.keyboard.press('r')
  await eventually(async () => {
    const after = (await idb()).planets.find((p) => p.name === 'Viagens')
    return after.lane !== before.lane || Math.abs(after.phase - before.phase) > 0.01
  }, 8000, 'nova posição gravada')
})

await check('recarrega a página: tudo foi preservado', async () => {
  await page.waitForTimeout(600)
  await page.reload()
  await page.getByRole('button', { name: /Ir para SEP/ }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: /Ir para Viagens/ }).waitFor()
  const name = await page.getByTestId('universe-name').innerText()
  if (name !== 'Cosmos Tracbel') throw new Error(`nome do universo: ${name}`)
  const d = await idb()
  if (d.planets.length !== 2 || d.groups.length !== 3 || d.tasks.length !== 3) throw new Error(`contagens após recarregar: ${d.planets.length}/${d.groups.length}/${d.tasks.length}`)
  await page.waitForTimeout(3500)
  await shot('06-after-reload')
})

await check('edita grupo (renomear) e planeta (nome + cor) pela interface', async () => {
  await page.getByRole('button', { name: /Ir para SEP/ }).click()
  await page.waitForTimeout(500)
  await click(label('Grupo', 'Relatórios'))
  await page.waitForTimeout(500)
  await page.keyboard.press('e')
  await page.getByTestId('group-name').fill('Relatórios Gerenciais')
  await page.getByTestId('group-save').click()
  await eventually(async () => (await idb()).groups.some((g) => g.name === 'Relatórios Gerenciais'), 8000, 'grupo renomeado')
  await page.keyboard.press('Escape') // → planet
  await page.getByRole('button', { name: /Editar planeta/ }).click()
  await page.getByTestId('lab-name').fill('SEP — Excelência')
  await page.getByRole('button', { name: 'Paleta Gelo' }).click()
  await page.getByTestId('lab-confirm').click()
  await eventually(async () => {
    const p = (await idb()).planets.find((x) => x.name === 'SEP — Excelência')
    return p && p.style.colors.primary === '#9fc4dd'
  }, 8000, 'planeta editado')
})

await check('exporta backup, apaga tudo e restaura pela importação', async () => {
  await page.getByTestId('settings-btn').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-btn').click()])
  if (!download.suggestedFilename().startsWith('orbita-backup-')) throw new Error('nome do backup')
  const file = await download.path()
  await page.getByRole('button', { name: 'Apagar tudo' }).click()
  await page.getByTestId('confirm-ok').click()
  await eventually(async () => {
    const d = await idb()
    return d.planets.length === 0 && d.groups.length === 0 && d.tasks.length === 0
  }, 8000, 'universo apagado')
  await page.getByTestId('empty-universe').waitFor()
  await page.getByTestId('settings-btn').click()
  await page.getByTestId('import-input').setInputFiles(file)
  await page.getByTestId('confirm-ok').click()
  await eventually(async () => {
    const d = await idb()
    return d.planets.length === 2 && d.groups.length === 3 && d.tasks.length === 3
  }, 10000, 'backup restaurado')
  await page.getByRole('button', { name: /Ir para SEP/ }).waitFor()
})

await check('exclui planeta pelo laboratório com confirmação (cascata)', async () => {
  await page.getByRole('button', { name: /Ir para SEP/ }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Editar planeta/ }).click()
  await page.getByRole('button', { name: 'Excluir' }).click()
  await page.getByTestId('confirm-ok').click()
  await eventually(async () => {
    const d = await idb()
    return d.planets.length === 1 && d.groups.length === 0 && d.tasks.length === 0
  }, 8000, 'cascata de exclusão')
})

await check('nenhum erro no console durante todo o fluxo', async () => {
  const relevant = problems.filter((p) => !/Download the React DevTools|THREE\.Clock/.test(p))
  if (relevant.length) throw new Error(relevant.slice(0, 3).join(' | '))
})

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`)
process.exit(failed.length ? 1 : 0)
