/**
 * Adjustments: (1) orbits and moons visible and animated in the universe, (2) density control that follows
 * screen size, zoom and graphics profile, (3) local attachments on tasks.
 *
 *   npm run dev            # in one terminal
 *   npm run e2e:ajustes    # in another
 *
 * Needs a DEV server (window.__orbita). Simulation uses a fixed step and waits are counted in rendered frames.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { boot, synth } from './lib/app.mjs'
import { GL_ARGS, loadPlaywright } from './lib/browser.mjs'

const { chromium } = loadPlaywright()
const SHOTS = new URL('./shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
const ONLY = process.env.ONLY

const results = []
let n = 0
async function check(page, name, fn) {
  if (ONLY && !ONLY.split(',').some((o) => name.startsWith(o))) return
  n++
  const t0 = Date.now()
  try {
    const info = await fn()
    results.push({ ok: true, name })
    console.log(`  ✓ ${String(n).padStart(2, '0')} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)${info ? `\n      ${info}` : ''}`)
  } catch (e) {
    results.push({ ok: false, name, error: e.message })
    console.log(`  ✗ ${String(n).padStart(2, '0')} ${name}\n      ${e.message.split('\n')[0]}`)
    await page.screenshot({ path: `${SHOTS}ajustes-fail-${n}.png` }).catch(() => {})
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

const browser = await chromium.launch({ args: GL_ARGS })
const A = await boot(browser, { viewport: { width: 1440, height: 860 } })
const { page } = A
await page.evaluate(() => (window.__orbita.runtime.fixedDt = 1 / 20))
const settle = (k = 100) => A.frames(k)

/** what the universe is drawing right now */
const sceneReport = () =>
  page.evaluate(() => {
    const o = window.__orbita
    const r = o.runtime
    const d = o.dataStore.get().data
    const u = o.uiStore.get()
    const moons = [...r.pos.keys()].filter((k) => k.startsWith('g:'))
    const visibleMoons = [...r.moonOrbit.values()].filter((m) => m.presence > 0.5).length
    const labels = [...document.querySelectorAll('.labels .wl:not(.hidden)')].map((e) => e.getBoundingClientRect())
    let overlaps = 0
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]
        const b = labels[j]
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps++
      }
    return {
      planets: d.planets.length,
      groups: d.groups.length,
      tasks: d.tasks.length,
      systems: u.systemPlanets.length,
      mounted: moons.length,
      visibleMoons,
      lodSum: [...r.lod.values()].reduce((a, b) => a + b, 0),
      labels: labels.length,
      overlaps,
      dist: r.cam.dist,
    }
  })

console.log('ÓRBITA ajustes →', process.env.ORBITA_URL ?? 'http://127.0.0.1:5173/')

/* ------------------------------------------------------------ 1. orbits */
await check(page, '1. órbitas e luas visíveis e animadas no universo, sem clicar', async () => {
  await settle(100)
  const r = await sceneReport()
  assert((await page.evaluate(() => window.__orbita.uiStore.get().planetId)) === null, 'deveria estar no universo')
  assert(r.systems >= 3, `planetas com órbitas: ${r.systems}`)
  assert(r.visibleMoons >= 5, `luas visíveis: ${r.visibleMoons}`)
  // animated: moons really move along their orbits while nothing is clicked
  const before = await page.evaluate(() => [...window.__orbita.runtime.pos].filter(([k]) => k.startsWith('g:')).map(([k, v]) => [k, v.toArray()]))
  await settle(60)
  const after = await page.evaluate(() => Object.fromEntries([...window.__orbita.runtime.pos].filter(([k]) => k.startsWith('g:')).map(([k, v]) => [k, v.toArray()])))
  const moved = before.filter(([k, v]) => after[k] && Math.hypot(...v.map((x, i) => x - after[k][i])) > 0.02).length
  assert(moved >= Math.max(3, before.length - 1), `luas que se moveram: ${moved}/${before.length}`)
  // compact orbits stay inside the room between neighbouring planets
  const wide = await page.evaluate(() => {
    const r = window.__orbita.runtime
    let worst = 0
    for (const [k, v] of r.pos) {
      if (!k.startsWith('g:')) continue
      const g = window.__orbita.dataStore.get().data.groups.find((x) => x.id === k.slice(2))
      const c = r.pos.get(`p:${g.planetId}`)
      if (c) worst = Math.max(worst, v.distanceTo(c))
    }
    return worst
  })
  assert(wide < 6.8, `órbita compacta grande demais: ${wide.toFixed(1)}`)
  await page.screenshot({ path: `${SHOTS}ajustes-1-universo-com-luas.png` })
  return `${r.systems} planetas com órbitas, ${r.visibleMoons} luas, ${moved} em movimento, raio máx. ${wide.toFixed(1)}`
})

await check(page, '1b. clicar no planeta mantém a navegação e abre todos os grupos', async () => {
  const id = await A.planetId('Trabalho')
  const at = await A.screen(`p:${id}`)
  await page.mouse.click(at.x, at.y)
  await settle(150)
  const s = await page.evaluate(() => {
    const u = window.__orbita.uiStore.get()
    const d = window.__orbita.dataStore.get().data
    const groups = d.groups.filter((g) => g.planetId === u.planetId)
    const r = window.__orbita.runtime
    return { planetId: u.planetId, groups: groups.length, anchors: groups.filter((g) => r.pos.has(`g:${g.id}`)).length, tasks: d.tasks.filter((t) => t.planetId === u.planetId).length, sats: d.tasks.filter((t) => t.planetId === u.planetId && r.pos.has(`t:${t.id}`)).length }
  })
  assert(s.planetId === id, 'não entrou no planeta')
  assert(s.anchors === s.groups, `luas ${s.anchors}/${s.groups}`)
  assert(s.sats === s.tasks, `satélites ${s.sats}/${s.tasks}`)
  await page.screenshot({ path: `${SHOTS}ajustes-1b-planeta.png` })
  await page.evaluate(() => window.__orbita.uiStore.set({ planetId: null, groupId: null, taskId: null, taskPanel: null }))
  await settle(120)
  return `${s.groups} grupos e ${s.tasks} tarefas acessíveis`
})

/* ------------------------------------------------------------ 2. density */
const scenario = async (vp, planets, groups, tasks) => {
  await page.setViewportSize(vp)
  await synth(page, { planets, groups, tasks })
  await settle(160)
  return sceneReport()
}

await check(page, '2. poucos elementos: tudo cabe e aparece', async () => {
  const r = await scenario({ width: 1440, height: 860 }, 3, 3, 4)
  assert(r.systems === 3, `planetas com órbitas: ${r.systems}/3`)
  assert(r.visibleMoons >= 7, `luas visíveis: ${r.visibleMoons}/9`)
  assert(r.overlaps === 0, `rótulos sobrepostos: ${r.overlaps}`)
  await page.screenshot({ path: `${SHOTS}ajustes-2-poucos.png` })
  return JSON.stringify(r)
})

const sizes = {}
for (const vp of [
  { width: 800, height: 600 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
]) {
  await check(page, `3. muitos elementos (24 planetas × 6 grupos) em ${vp.width}×${vp.height}: excedentes ocultos, dados intactos`, async () => {
    const r = await scenario(vp, 24, 6, 5)
    sizes[vp.width] = r
    assert(r.groups === 144 && r.tasks === 720, `dados alterados: ${r.groups} grupos, ${r.tasks} tarefas`)
    assert(r.systems <= 13, `planetas com órbitas além do orçamento: ${r.systems}`)
    assert(r.mounted <= r.systems * 10, `luas montadas: ${r.mounted}`)
    assert(r.mounted < 144, 'nenhum excedente foi omitido')
    assert(r.overlaps === 0, `rótulos sobrepostos: ${r.overlaps}`)
    await page.screenshot({ path: `${SHOTS}ajustes-3-muitos-${vp.width}.png` })
    return JSON.stringify({ systems: r.systems, mounted: r.mounted, visibleMoons: r.visibleMoons, labels: r.labels })
  })
}

await check(page, '3b. telas maiores mostram mais; telas menores, menos', async () => {
  assert(sizes[800] && sizes[2560], 'faltam medições')
  assert(sizes[800].mounted <= sizes[1920].mounted, `800 (${sizes[800].mounted}) deveria montar ≤ 1920 (${sizes[1920].mounted})`)
  assert(sizes[1920].mounted <= sizes[2560].mounted, `1920 (${sizes[1920].mounted}) deveria montar ≤ 2560 (${sizes[2560].mounted})`)
  assert(sizes[800].mounted < sizes[2560].mounted, 'a tela pequena não reduziu nada')
  return Object.entries(sizes)
    .map(([w, r]) => `${w}px: ${r.systems} planetas / ${r.mounted} luas`)
    .join(' · ')
})

await check(page, '4. zoom: afastar reduz o detalhe progressivamente, aproximar devolve', async () => {
  await page.setViewportSize({ width: 1440, height: 860 })
  await synth(page, { planets: 12, groups: 4, tasks: 3 })
  await settle(160)
  const near = await sceneReport()
  await A.wheel(720, 430, 100, 7, 4)
  await settle(120)
  const mid = await sceneReport()
  await A.wheel(720, 430, 100, 7, 4)
  await settle(120)
  const far = await sceneReport()
  await page.screenshot({ path: `${SHOTS}ajustes-4-longe.png` })
  assert(far.lodSum <= mid.lodSum + 0.05 && mid.lodSum <= near.lodSum + 0.05, `detalhe não decresce: ${near.lodSum.toFixed(1)} → ${mid.lodSum.toFixed(1)} → ${far.lodSum.toFixed(1)}`)
  assert(far.visibleMoons < near.visibleMoons, `luas visíveis ${near.visibleMoons} → ${far.visibleMoons}`)
  await A.wheel(720, 430, -100, 14, 4)
  await settle(140)
  const back = await sceneReport()
  assert(back.lodSum > far.lodSum, 'aproximar não devolveu o detalhe')
  return `luas visíveis: ${near.visibleMoons} → ${mid.visibleMoons} → ${far.visibleMoons}; de volta ${back.visibleMoons}`
})

await check(page, '5. planeta com muitos grupos: todos os grupos e tarefas ficam acessíveis ao selecionar', async () => {
  await synth(page, { planets: 6, groups: 14, tasks: 4 })
  await settle(100)
  const id = 'sp0'
  const at = await A.screen(`p:${id}`)
  await page.mouse.click(at.x, at.y)
  await settle(200)
  const r = await page.evaluate((id) => {
    const o = window.__orbita
    const d = o.dataStore.get().data
    const groups = d.groups.filter((g) => g.planetId === id)
    return { open: o.uiStore.get().planetId, groups: groups.length, anchors: groups.filter((g) => o.runtime.pos.has(`g:${g.id}`)).length }
  }, id)
  assert(r.open === id, 'não entrou')
  assert(r.anchors === r.groups, `luas ${r.anchors}/${r.groups}`)
  const rep = await sceneReport()
  assert(rep.overlaps === 0, `rótulos sobrepostos: ${rep.overlaps}`)
  await page.screenshot({ path: `${SHOTS}ajustes-5-muitos-grupos.png` })
  await page.evaluate(() => window.__orbita.uiStore.set({ planetId: null, groupId: null }))
  return `${r.groups}/${r.groups} grupos como luas`
})

/* ------------------------------------------------------- 6. attachments */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
const XLSX = Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
const DOCX = Buffer.from([0x50, 0x4b, 3, 4, 9, 8, 7, 6])

// the synthetic universes above were never persisted: reloading brings the stored example universe back
await page.reload()
await page.waitForFunction(() => window.__orbita?.dataStore.get().ready && window.__orbita.dataStore.get().data.tasks.length > 0)
await page.evaluate(() => (window.__orbita.runtime.fixedDt = 1 / 20))

const firstTask = () =>
  page.evaluate(() => {
    const o = window.__orbita
    const t = o.dataStore.get().data.tasks[0]
    o.uiStore.set({ planetId: t.planetId, groupId: t.groupId, taskId: t.id, taskPanel: { mode: 'edit' } })
    return t.id
  })

let taskId
await check(page, '6. anexar PDF, imagem, planilha e documento a uma tarefa (IndexedDB local)', async () => {
  taskId = await firstTask()
  await page.getByTestId('attachments').waitFor()
  await page.getByTestId('attach-input').setInputFiles([
    { name: 'laudo.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'foto.png', mimeType: 'image/png', buffer: PNG },
    { name: 'balanco.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX },
    { name: 'contrato.docx', mimeType: '', buffer: DOCX },
  ])
  await page.waitForFunction((id) => window.__orbita.dataStore.get().data.tasks.find((t) => t.id === id).attachments.length === 4, taskId)
  assert((await page.getByTestId('attachment').count()) === 4, 'lista não mostra 4 anexos')
  const names = await page.getByTestId('attachment').locator('.attach-name').allTextContents()
  assert(names.join('|') === 'laudo.pdf|foto.png|balanco.xlsx|contrato.docx', `nomes: ${names}`)
  // really in IndexedDB, byte for byte
  const stored = await page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('orbita')
        r.onsuccess = () => {
          const g = r.result.transaction('files').objectStore('files').getAll()
          g.onsuccess = () => resolve(g.result.map((f) => ({ taskId: f.taskId, name: f.name, size: f.size, bytes: [...new Uint8Array(f.data)].slice(0, 4) })))
          g.onerror = () => reject(g.error)
        }
        r.onerror = () => reject(r.error)
      }),
    taskId,
  )
  assert(stored.length === 4 && stored.every((f) => f.taskId === taskId), `IndexedDB: ${JSON.stringify(stored)}`)
  assert(stored.find((f) => f.name === 'balanco.xlsx').bytes.join() === '80,75,3,4', 'bytes diferentes do original')
  await page.screenshot({ path: `${SHOTS}ajustes-6-anexos.png` })
  return `4 arquivos em IndexedDB (${stored.map((f) => f.size).join(', ')} bytes)`
})

await check(page, '6b. visualizar imagem e PDF; planilha e documento só oferecem baixar', async () => {
  const items = page.getByTestId('attachment')
  // image
  await items.nth(1).getByTestId('attachment-view').click()
  const img = page.getByTestId('attachment-viewer').locator('img')
  await img.waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid="attachment-viewer"] img')?.naturalWidth > 0)
  // the viewer is a real dialog over the whole app, not squeezed into the task panel
  const box = await page.locator('.modal').last().boundingBox()
  assert(box && box.width >= 480 && box.x < 500, `visualizador comprimido no painel: ${JSON.stringify(box)}`)
  await page.screenshot({ path: `${SHOTS}ajustes-6b-imagem.png` })
  await page.getByRole('button', { name: 'Fechar', exact: true }).last().click()
  // pdf
  await items.nth(0).getByTestId('attachment-view').click()
  await page.getByTestId('attachment-viewer').locator('iframe').waitFor()
  const src = await page.getByTestId('attachment-viewer').locator('iframe').getAttribute('src')
  assert(src?.startsWith('blob:'), `src do PDF: ${src}`)
  await page.getByRole('button', { name: 'Fechar', exact: true }).last().click()
  assert((await items.nth(2).getByTestId('attachment-view').count()) === 0, 'planilha não deveria ter “visualizar”')
  assert((await items.nth(3).getByTestId('attachment-view').count()) === 0, 'documento não deveria ter “visualizar”')
  assert((await items.nth(2).getByTestId('attachment-download').count()) === 1, 'planilha sem “baixar”')
})

await check(page, '6c. baixar devolve exatamente os mesmos bytes', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('attachment').nth(2).getByTestId('attachment-download').click()])
  assert(dl.suggestedFilename() === 'balanco.xlsx', `nome: ${dl.suggestedFilename()}`)
  const path = await dl.path()
  assert(readFileSync(path).equals(XLSX), 'conteúdo baixado difere do original')
})

await check(page, '6d. recarregar a página preserva os anexos', async () => {
  await page.evaluate(() => window.__orbita) // keep the page warm
  await page.waitForTimeout(400)
  await page.reload()
  await page.waitForFunction(() => window.__orbita?.dataStore.get().ready)
  await page.evaluate((id) => {
    const o = window.__orbita
    const t = o.dataStore.get().data.tasks.find((x) => x.id === id)
    o.uiStore.set({ planetId: t.planetId, groupId: t.groupId, taskId: id, taskPanel: { mode: 'edit' } })
  }, taskId)
  await page.getByTestId('attachments').waitFor()
  assert((await page.getByTestId('attachment').count()) === 4, 'anexos não voltaram')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('attachment').nth(0).getByTestId('attachment-download').click()])
  assert(readFileSync(await dl.path()).equals(PDF), 'PDF difere depois de recarregar')
})

await check(page, '6e. backup inclui os arquivos e a restauração os devolve', async () => {
  await page.getByTestId('settings-btn').click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-btn').click()])
  const text = readFileSync(await dl.path(), 'utf8')
  const json = JSON.parse(text)
  assert(json.schema === 2, `schema ${json.schema}`)
  assert(json.files.length === 4, `arquivos no backup: ${json.files.length}`)
  assert(Buffer.from(json.files.find((f) => f.name === 'balanco.xlsx').data, 'base64').equals(XLSX), 'bytes do backup diferem')
  // wipe everything, then restore
  await page.getByRole('button', { name: /Apagar tudo/ }).first().click()
  await page.getByRole('button', { name: 'Apagar tudo' }).last().click()
  await page.waitForFunction(() => window.__orbita.dataStore.get().data.tasks.length === 0)
  const left = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open('orbita')
        r.onsuccess = () => {
          const c = r.result.transaction('files').objectStore('files').count()
          c.onsuccess = () => resolve(c.result)
        }
      }),
  )
  assert(left === 0, `arquivos que sobraram depois de apagar tudo: ${left}`)
  await page.getByTestId('settings-btn').click()
  await page.getByTestId('import-input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  await page.getByRole('button', { name: /Importar e substituir/ }).click()
  await page.waitForFunction((id) => window.__orbita.dataStore.get().data.tasks.find((t) => t.id === id)?.attachments.length === 4, taskId)
  const back = await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const r = indexedDB.open('orbita')
        r.onsuccess = () => {
          const g = r.result.transaction('files').objectStore('files').getAll()
          g.onsuccess = () => resolve(g.result.map((f) => ({ name: f.name, bytes: [...new Uint8Array(f.data)] })))
        }
      }),
    taskId,
  )
  assert(back.length === 4, `arquivos restaurados: ${back.length}`)
  assert(back.find((f) => f.name === 'balanco.xlsx').bytes.join() === [...XLSX].join(), 'bytes restaurados diferem')
  return '4 arquivos exportados, apagados e restaurados byte a byte'
})

await check(page, '6f. excluir anexo: pede confirmação e dá para desfazer', async () => {
  await page.evaluate((id) => {
    const o = window.__orbita
    o.uiStore.set({ settingsOpen: false })
    const t = o.dataStore.get().data.tasks.find((x) => x.id === id)
    o.uiStore.set({ planetId: t.planetId, groupId: t.groupId, taskId: id, taskPanel: { mode: 'edit' } })
  }, taskId)
  await page.getByTestId('attachments').waitFor()
  await page.getByTestId('attachment').nth(3).getByTestId('attachment-delete').click()
  await page.locator('.modal').getByRole('button', { name: 'Excluir anexo' }).click()
  assert((await page.getByTestId('attachment').count()) === 3, 'o anexo não saiu da lista')
  await page.getByRole('button', { name: 'Desfazer' }).first().click()
  await page.waitForFunction((id) => window.__orbita.dataStore.get().data.tasks.find((t) => t.id === id).attachments.length === 4, taskId)
  assert((await page.getByTestId('attachment').count()) === 4, 'desfazer não devolveu o anexo')
  await page.screenshot({ path: `${SHOTS}ajustes-6f-desfazer.png` })
})

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} verificações ok`)
if (A.errors.length) console.log('erros no console:', A.errors.slice(0, 5))
await browser.close()
process.exit(results.every((r) => r.ok) && A.errors.length === 0 ? 0 : 1)
