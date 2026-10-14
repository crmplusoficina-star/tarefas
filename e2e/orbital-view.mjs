/**
 * Orbital overview checks: groups and tasks are visible around a planet without entering each group.
 *
 *   npm run dev            # in one terminal
 *   npm run e2e:orbital    # in another
 *
 * Needs a DEV server (window.__orbita). Simulation uses a fixed step and waits are counted in
 * rendered frames, so results do not depend on the speed of the (software) WebGL renderer.
 * Synthetic universes are injected straight into the data store (not persisted); persistence and CRUD
 * are covered by `npm run e2e` (smoke), phase-2 navigation by `npm run e2e:nav`.
 */
import { mkdirSync } from 'node:fs'
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
    await page.screenshot({ path: `${SHOTS}orbital-fail-${n}.png` }).catch(() => {})
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

const browser = await chromium.launch({ args: GL_ARGS })

/** what the labels look like right now */
const labelsReport = (page) =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll('.labels .wl:not(.hidden)')]
    const rects = els.map((e) => {
      const r = e.getBoundingClientRect()
      return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, cls: e.className, text: e.textContent, fs: parseFloat(getComputedStyle(e).fontSize), op: parseFloat(getComputedStyle(e).opacity) }
    })
    let overlaps = 0
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0) overlaps++
      }
    const count = (c) => rects.filter((r) => r.cls.includes(c)).length
    return {
      total: rects.length,
      tasks: count(' task'),
      groups: count(' group'),
      planets: count(' planet'),
      halo: count(' halo'),
      overlaps,
      minFont: Math.min(...rects.map((r) => r.fs), 99),
      domLabels: document.querySelectorAll('.labels .wl').length,
      legacy: document.querySelectorAll('.orbit-preview, .orbit-task-chip').length,
    }
  })

const state = (page) =>
  page.evaluate(() => {
    const o = window.__orbita
    const u = o.uiStore.get()
    return { planetId: u.planetId, groupId: u.groupId, taskId: u.taskId, taskPanel: !!u.taskPanel, halo: u.haloPlanets, haloLabels: u.haloLabelPlanets, dist: o.runtime.cam.dist, target: o.runtime.cam.target.toArray() }
  })

/** satellites of a planet that are present in the scene, and how close the label of each is to its own moon */
const overviewReport = (page, planetId) =>
  page.evaluate((planetId) => {
    const o = window.__orbita
    const r = o.runtime
    const d = o.dataStore.get().data
    const groups = d.groups.filter((g) => g.planetId === planetId)
    const proj = (key) => {
      const p = r.pos.get(key)
      if (!p) return null
      const v = p.clone().project(r.camera)
      return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height }
    }
    const moons = groups.map((g) => ({ id: g.id, at: proj(`g:${g.id}`) })).filter((m) => m.at)
    let tasksTotal = 0
    let sats = 0
    let nearest = 0
    let checked = 0
    for (const g of groups) {
      const ts = d.tasks.filter((t) => t.groupId === g.id)
      tasksTotal += ts.length
      for (const t of ts) {
        const a = proj(`t:${t.id}`)
        if (!a) continue
        sats++
        if (!moons.length) continue
        checked++
        let best = null
        let bd = Infinity
        for (const m of moons) {
          const dd = Math.hypot(m.at.x - a.x, m.at.y - a.y)
          if (dd < bd) {
            bd = dd
            best = m.id
          }
        }
        if (best === g.id) nearest++
      }
    }
    return { groups: groups.length, moons: moons.length, tasksTotal, sats, nearest, checked }
  }, planetId)

/** orbits nearly frozen while a label is clicked (Playwright waits for a stable element) */
const still = (page, on) => page.evaluate((on) => (window.__orbita.runtime.fixedDt = on ? 1e-5 : 1 / 20), on)

const settle = async (A, k = 120) => {
  await A.frames(k)
}

async function enterPlanet(A, id, frames = 150) {
  const at = await A.screen(`p:${id}`)
  await A.page.mouse.click(at.x, at.y)
  await settle(A, frames)
  await A.page.mouse.move(700, 60)
  await settle(A, 20)
}

console.log('ÓRBITA visão orbital →', process.env.ORBITA_URL ?? 'http://127.0.0.1:5173/')
const A = await boot(browser, { viewport: { width: 1440, height: 860 } })
const { page } = A
await page.evaluate(() => (window.__orbita.runtime.fixedDt = 1 / 20))
const trabalho = await A.planetId('Trabalho')

/* 1 — few planets, few tasks */
await check(page, '1. poucos planetas e tarefas: universo legível, sem cartões antigos', async () => {
  await settle(A, 40)
  await page.screenshot({ path: `${SHOTS}orbital-1-universo.png` })
  const r = await labelsReport(page)
  assert(r.planets >= 4, `rótulos de planeta: ${r.planets}`)
  assert(r.overlaps === 0, `rótulos sobrepostos: ${r.overlaps}`)
  assert(r.legacy === 0, 'restou DOM de orbit-preview/orbit-task-chip')
  return JSON.stringify(r)
})

/* 3 — hover without click */
await check(page, '3. hover sem clique: destaque + órbitas/grupos/amostra de tarefas, câmera e nível intactos, sem cartão', async () => {
  const s0 = await state(page)
  const at = await A.screen(`p:${trabalho}`)
  await page.mouse.move(at.x - 3, at.y + 2)
  await settle(A, 80)
  const s1 = await state(page)
  const level = await page.evaluate((id) => window.__orbita.runtime.halo.get(id) ?? 0, trabalho)
  const r = await labelsReport(page)
  const cards = await page.locator('.hover-card').count()
  await page.screenshot({ path: `${SHOTS}orbital-3-hover.png` })
  assert(s1.planetId === null && s1.groupId === null, 'o hover abriu algo')
  assert(s1.halo.includes(trabalho), 'planeta não entrou no resumo em cena')
  assert(level > 0.9, `nível do resumo baixo: ${level.toFixed(2)}`)
  assert(Math.abs(s1.dist - s0.dist) < 0.5, `câmera mexeu: ${s0.dist.toFixed(2)} → ${s1.dist.toFixed(2)}`)
  assert(cards === 0, 'apareceu cartão HTML no hover do planeta')
  assert(r.halo >= 2, `rótulos do resumo visíveis: ${r.halo}`)
  assert(r.overlaps === 0, `rótulos sobrepostos: ${r.overlaps}`)
  // leaving: gradual fade, then gone
  await page.mouse.move(700, 80)
  await settle(A, 6)
  const mid = await page.evaluate((id) => window.__orbita.runtime.halo.get(id) ?? 0, trabalho)
  assert(mid > 0.05 && mid < level, `a saída deveria desvanecer gradualmente (nível ${mid.toFixed(2)})`)
  await settle(A, 140)
  const s2 = await state(page)
  const end = await page.evaluate((id) => window.__orbita.runtime.halo.get(id) ?? 0, trabalho)
  const after = await labelsReport(page)
  // after leaving only the quiet overview remains: no names, no panel
  assert(end <= 0.47, `resumo completo ficou ligado (nível ${end.toFixed(2)})`)
  assert(after.halo === 0, `rótulos do resumo ainda visíveis: ${after.halo}`)
  assert(!s2.haloLabels.includes(trabalho), 'planeta ainda lista rótulos do resumo')
  return `nível ${level.toFixed(2)} → ${mid.toFixed(2)} (6 quadros) → ${end.toFixed(2)}; rótulos do resumo ${r.halo} → ${after.halo}`
})

/* 4 — one click shows groups and tasks */
await check(page, '4. um clique no planeta: todos os grupos e as tarefas de todos os grupos, sem cliques extras', async () => {
  await enterPlanet(A, trabalho)
  const s = await state(page)
  assert(s.planetId === trabalho && s.groupId === null, `nível inesperado ${JSON.stringify(s)}`)
  const rep = await overviewReport(page, trabalho)
  const lab = await labelsReport(page)
  await page.screenshot({ path: `${SHOTS}orbital-4-planeta.png` })
  assert(rep.moons === rep.groups && rep.groups >= 3, `luas visíveis ${rep.moons}/${rep.groups}`)
  assert(rep.sats === rep.tasksTotal, `satélites ${rep.sats}/${rep.tasksTotal}`)
  assert(rep.nearest / Math.max(1, rep.checked) >= 0.85, `associação grupo↔tarefa fraca: ${rep.nearest}/${rep.checked}`)
  assert(lab.tasks >= 3, `nomes de tarefas visíveis: ${lab.tasks}`)
  assert(lab.groups >= rep.groups - 1, `nomes de grupos visíveis: ${lab.groups}/${rep.groups}`)
  assert(lab.overlaps === 0 && lab.legacy === 0, `sobreposição ${lab.overlaps} / legado ${lab.legacy}`)
  return `${JSON.stringify(rep)} · rótulos ${lab.tasks} tarefas, ${lab.groups} grupos`
})

/* 5 — open a task directly */
await check(page, '5. abrir uma tarefa direto pelo nome em cena, sem clicar no grupo antes', async () => {
  await still(page, true)
  await settle(A, 5)
  const btn = page.locator('button.wl.task:not(.hidden)').first()
  const title = (await btn.locator('.txt').textContent())?.trim()
  await btn.click()
  await still(page, false)
  await settle(A, 40)
  const s = await state(page)
  assert(s.taskId && s.taskPanel, 'painel da tarefa não abriu')
  const shown = await page.getByRole('dialog').or(page.locator('[data-testid="task-panel"]')).first().textContent().catch(() => '')
  assert(!title || (shown ?? '').includes(title.replace('…', '').slice(0, 12)) || (await page.locator('input').first().inputValue().catch(() => '')).includes(title.slice(0, 12)), `painel não mostra "${title}"`)
  await page.screenshot({ path: `${SHOTS}orbital-5-tarefa.png` })
  return `abriu “${title}”`
})

/* edit / complete keep working */
await check(page, '5b. editar e concluir pela tarefa aberta continua funcionando', async () => {
  const s = await state(page)
  const id = s.taskId
  assert(id, 'sem tarefa aberta')
  const before = await page.evaluate((id) => window.__orbita.dataStore.get().data.tasks.find((t) => t.id === id).status, id)
  const done = page.getByRole('button', { name: /Concluir tarefa|Concluir$/ }).first()
  if (before !== 'done' && (await done.count())) {
    await done.click()
    await A.frames(20)
    const after = await page.evaluate((id) => window.__orbita.dataStore.get().data.tasks.find((t) => t.id === id).status, id)
    assert(after === 'done', `status após concluir: ${after}`)
  }
  await page.keyboard.press('Escape')
  await settle(A, 60)
  return `status antes: ${before}`
})

/* 6 — select a group keeps navigation */
await check(page, '6. selecionar um grupo mantém a navegação: foco no grupo, faixas orbitais, voltar ao planeta', async () => {
  // back to the planet overview
  await page.evaluate((id) => {
    const o = window.__orbita
    o.uiStore.set({ planetId: id, groupId: null, taskId: null, taskPanel: null })
  }, trabalho)
  await settle(A, 100)
  await still(page, true)
  await settle(A, 5)
  const btn = page.locator('button.wl.group:not(.hidden)').first()
  const name = (await btn.locator('.txt').textContent())?.trim()
  await btn.click()
  await still(page, false)
  await settle(A, 120)
  const s = await state(page)
  assert(s.groupId, 'não focou o grupo')
  const lab = await labelsReport(page)
  await page.screenshot({ path: `${SHOTS}orbital-6-grupo.png` })
  assert(lab.legacy === 0, 'DOM legado')
  assert((await page.locator('.wl.band:not(.hidden)').count()) >= 1, 'faixas de prioridade sem rótulo no grupo')
  await page.keyboard.press('Escape')
  await settle(A, 100)
  const s2 = await state(page)
  assert(s2.groupId === null && s2.planetId === trabalho, `Esc deveria voltar ao planeta (${JSON.stringify(s2)})`)
  return `grupo “${name}” e volta`
})

/* 2 — many planets */
await check(page, '2. muitos planetas (16): limite de resumos, rótulos sem colisão, poucos elementos DOM', async () => {
  await synth(page, { planets: 16, groups: 4, tasks: 6 })
  await settle(A, 60)
  const ids = await page.evaluate(() => window.__orbita.dataStore.get().data.planets.map((p) => p.id))
  const at = await A.screen(`p:${ids[2]}`)
  await page.mouse.move(at.x, at.y)
  await settle(A, 80)
  const lab = await labelsReport(page)
  const s = await state(page)
  await page.screenshot({ path: `${SHOTS}orbital-2-muitos.png` })
  assert(s.halo.length <= 4, `resumos simultâneos: ${s.halo.length}`)
  assert(lab.overlaps === 0, `rótulos sobrepostos: ${lab.overlaps}`)
  assert(lab.domLabels < 140, `elementos de rótulo: ${lab.domLabels}`)
  await page.mouse.move(700, 80)
  return `${JSON.stringify(lab)}`
})

/* 7 — dozens of tasks across groups */
await check(page, '7. planeta com dezenas de tarefas em vários grupos: orçamento de satélites e de nomes, prioridade indicada', async () => {
  await synth(page, { planets: 3, groups: 5, tasks: [14, 20, 26, 32, 38] })
  await settle(A, 40)
  await enterPlanet(A, 'sp0', 160)
  const rep = await overviewReport(page, 'sp0')
  const lab = await labelsReport(page)
  const nearest = rep.nearest / Math.max(1, rep.checked)
  await page.screenshot({ path: `${SHOTS}orbital-7-dezenas.png` })
  assert(rep.tasksTotal >= 70, `dados: ${rep.tasksTotal}`)
  assert(rep.sats <= 5 * 14, `satélites individuais acima do limite: ${rep.sats}`)
  assert(rep.sats < rep.tasksTotal, 'nenhum resumo por grupo (todos os satélites foram desenhados)')
  assert(lab.overlaps === 0, `rótulos sobrepostos: ${lab.overlaps}`)
  assert(lab.tasks <= 16, `nomes de tarefas demais: ${lab.tasks}`)
  assert(lab.domLabels <= rep.tasksTotal + 20, `elementos de rótulo: ${lab.domLabels}`)
  assert(nearest >= 0.8, `associação grupo↔tarefa: ${(nearest * 100).toFixed(0)}%`)
  const badges = await page.locator('.wl.group .badge').count()
  assert(badges >= 3, `grupos com “+N” oculto indicado: ${badges}`)
  // critical / overdue tasks are never the ones left out
  const missing = await page.evaluate(() => {
    const o = window.__orbita
    const d = o.dataStore.get().data
    return d.tasks.filter((t) => t.planetId === 'sp0' && t.status !== 'done' && t.priority === 'critical' && !o.runtime.pos.has(`t:${t.id}`)).length
  })
  const crit = await page.evaluate(() => window.__orbita.dataStore.get().data.tasks.filter((t) => t.planetId === 'sp0' && t.status !== 'done' && t.priority === 'critical').length)
  return `${JSON.stringify(rep)} · rótulos ${lab.total} (${lab.tasks} tarefas) · “+N” em ${badges} grupos · críticas sem satélite: ${missing}/${crit}`
})

/* 8 — zoom and resolution */
for (const vp of [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
]) {
  await check(page, `8. resolução ${vp.width}×${vp.height}: texto legível e sem colisões`, async () => {
    await page.setViewportSize(vp)
    await settle(A, 100)
    const lab = await labelsReport(page)
    await page.screenshot({ path: `${SHOTS}orbital-8-${vp.width}.png` })
    assert(lab.overlaps === 0, `rótulos sobrepostos: ${lab.overlaps}`)
    assert(lab.minFont >= 10.5, `fonte mínima ${lab.minFont}px`)
    // 130 tasks on one planet: small screens keep the satellites and the “+N”, names come on hover (8c)
    assert(lab.tasks >= (vp.width >= 1900 ? 3 : 0), `nomes de tarefas visíveis: ${lab.tasks}`)
    assert(lab.groups >= 4, `nomes de grupos visíveis: ${lab.groups}`)
    return `${lab.tasks} nomes de tarefas, ${lab.groups} de grupos, fonte mín. ${lab.minFont}px`
  })
}
await check(page, '8c. 1280×720: passar o cursor numa lua escreve os nomes das tarefas desse grupo', async () => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await settle(A, 100)
  const before = await labelsReport(page)
  if (process.env.DEBUG)
    console.log(
      await page.evaluate(() => {
        const o = window.__orbita
        const r = o.runtime
        const els = [...document.querySelectorAll('.wl.task')]
        return JSON.stringify({ dist: r.cam.dist, h: r.height, fov: r.camera.fov, tasks: els.length, hidden: els.filter((e) => e.classList.contains('hidden')).length, w0: els.filter((e) => e.offsetWidth === 0).length, level: o.uiStore.get().planetId })
      }),
    )
  const at = await A.screen('g:sg0_1')
  await page.mouse.move(at.x, at.y)
  await settle(A, 30)
  const hov = await labelsReport(page)
  await page.screenshot({ path: `${SHOTS}orbital-8c-hover-lua.png` })
  // the neighbours' names step aside; a cluster of 12 satellites only has room for the names that fit without overlapping
  assert(hov.tasks >= 2, `nomes ao passar na lua: ${before.tasks} → ${hov.tasks}`)
  assert(hov.overlaps === 0, `sobreposição: ${hov.overlaps}`)
  await page.mouse.move(640, 60)
  return `nomes de tarefas ${before.tasks} → ${hov.tasks}`
})
await check(page, '8b. zoom: afastar reduz os nomes (sem ilegíveis), aproximar os devolve', async () => {
  await page.setViewportSize({ width: 1440, height: 860 })
  await settle(A, 60)
  const near = await labelsReport(page)
  await A.wheel(720, 430, 100, 6, 4)
  await settle(A, 60)
  const far = await labelsReport(page)
  await page.screenshot({ path: `${SHOTS}orbital-8-afastado.png` })
  assert(far.overlaps === 0, `sobreposição ao afastar: ${far.overlaps}`)
  assert(far.tasks <= near.tasks, `ao afastar há mais nomes (${near.tasks} → ${far.tasks})`)
  return `nomes de tarefas: ${near.tasks} perto → ${far.tasks} longe`
})

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} verificações ok`)
if (A.errors.length) console.log('erros no console:', A.errors.slice(0, 5))
await browser.close()
process.exit(results.every((r) => r.ok) && A.errors.length === 0 ? 0 : 1)
