/**
 * Spatial-navigation checks (phase 2): zoom-to-cursor, zoom-to-open / zoom-to-leave,
 * camera continuity, and non-interference with panels, the lab and reduced motion.
 *
 *   npm run dev            # in one terminal
 *   npm run e2e:nav        # in another
 *
 * Needs a DEV server (window.__orbita). The simulation is stepped with a fixed time step and
 * waits are counted in rendered frames, so the checks do not depend on how fast the
 * (software) WebGL renderer is.
 */
import { mkdirSync } from 'node:fs'
import { boot as bootApp } from './lib/app.mjs'
import { GL_ARGS, loadPlaywright } from './lib/browser.mjs'

const { chromium } = loadPlaywright()
const BASE = process.env.ORBITA_URL ?? 'http://127.0.0.1:5173/'
const SHOTS = new URL('./shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const results = []
let n = 0
const ONLY = process.env.ONLY // e.g. ONLY=F runs just the checks whose name starts with "F."
async function check(page, name, fn) {
  if (ONLY && !name.startsWith(ONLY) && !name.startsWith('nenhum erro')) return
  n++
  const t0 = Date.now()
  try {
    await fn()
    results.push({ ok: true, name })
    console.log(`  ✓ ${String(n).padStart(2, '0')} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  } catch (e) {
    results.push({ ok: false, name, error: e.message })
    console.log(`  ✗ ${String(n).padStart(2, '0')} ${name}\n      ${e.message.split('\n')[0]}`)
    await page.screenshot({ path: `${SHOTS}nav-fail-${n}.png` }).catch(() => {})
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

const browser = await chromium.launch({ args: GL_ARGS })
const boot = (opts) => bootApp(browser, opts)

/** largest camera step between consecutive frames, relative to the camera distance */
const maxStep = (rec, key = 'pos') => {
  let m = 0
  for (let i = 1; i < rec[key].length; i++) m = Math.max(m, api_dist(rec[key][i], rec[key][i - 1]) / Math.max(1, rec.dist[i]))
  return m
}
const api_dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))

console.log(`ÓRBITA navegação → ${BASE}`)
let A = await boot()
const { page } = A
const viagens = await A.planetId('Viagens')

/* ------------------------------------------------------------------ A */
await check(page, 'A. aproximar um planeta só com a roda (sem clicar): câmera converge e nada é aberto', async () => {
  const s0 = await A.state()
  assert(s0.level === 'universe', 'deveria começar no universo')
  const p0 = (await page.evaluate((id) => window.__orbita.runtime.pos.get(`p:${id}`).toArray(), viagens))
  const gap0 = A.dist3(s0.target, p0)
  const at = await A.screen(`p:${viagens}`)
  await page.mouse.move(at.x, at.y)
  await A.frames(10)
  await A.startRec()
  // stop well before the entry threshold: a short, deliberate approach
  await A.wheel(at.x, at.y, -100, 7, 5, `p:${viagens}`)
  await A.frames(40)
  const rec = await A.stopRec()
  const s1 = await A.state()
  const p1 = await page.evaluate((id) => window.__orbita.runtime.pos.get(`p:${id}`).toArray(), viagens)
  assert(s1.level === 'universe' && s1.planetId === null, `não deveria entrar (nível=${s1.level})`)
  assert(s1.focus.key === `p:${viagens}`, `foco deveria ser Viagens, é ${s1.focus.key}`)
  assert(s1.dist < s0.dist * 0.75, `distância não diminuiu o suficiente: ${s0.dist.toFixed(1)} → ${s1.dist.toFixed(1)}`)
  const gap1 = A.dist3(s1.target, p1)
  assert(gap1 < gap0 * 0.7, `alvo não convergiu para o planeta: ${gap0.toFixed(1)} → ${gap1.toFixed(1)}`)
  // smooth: camera→planet distance never increases while zooming in
  const camToPlanet = rec.pos.map((p) => A.dist3(p, p1))
  const worstRise = Math.max(...camToPlanet.slice(1).map((d, i) => d - camToPlanet[i]))
  assert(worstRise < 0.35, `a câmera se afastou do planeta durante a aproximação (+${worstRise.toFixed(2)})`)
  assert(maxStep(rec) < 0.05, `salto de câmera: ${maxStep(rec).toFixed(3)}`)
  await page.screenshot({ path: `${SHOTS}nav-A-approach.png` })
})

/* ------------------------------------------------------------------ B */
await check(page, 'B. aproximar uma região vazia: ponto sob o cursor fica fixo, sem saltos e sem abrir nada', async () => {
  await page.keyboard.press('c')
  await A.frames(90)
  const x = 880
  const y = 470 // empty corner (no planet/label there)
  const before = await A.ground(x, y)
  assert(before, 'cursor não intercepta o plano do universo')
  await page.mouse.move(x, y)
  await A.frames(5)
  await A.startRec()
  const d0 = (await A.state()).dist
  await A.wheel(x, y, -100, 8, 5)
  await A.frames(50)
  const rec = await A.stopRec()
  const s = await A.state()
  const after = await A.ground(x, y)
  assert(s.level === 'universe' && s.planetId === null && s.peek === null && s.groupId === null, `estado mudou: ${JSON.stringify({ l: s.level, p: s.planetId, k: s.peek })}`)
  assert(s.dist < d0 * 0.6, `zoom não aproximou: ${d0.toFixed(1)} → ${s.dist.toFixed(1)}`)
  const drift = A.dist3(before, after)
  assert(drift < Math.max(1.2, s.dist * 0.04), `o ponto sob o cursor deslizou ${drift.toFixed(2)} unidades`)
  assert(maxStep(rec) < 0.05, `salto de câmera: ${maxStep(rec).toFixed(3)}`)
  // zoom out the same amount returns to (about) the starting framing: predictable and symmetric
  await A.wheel(x, y, 100, 8, 5)
  await A.frames(50)
  const back = await A.state()
  assert(Math.abs(back.dist - d0) / d0 < 0.12, `zoom out não desfez o zoom in: ${d0.toFixed(1)} vs ${back.dist.toFixed(1)}`)
})

/* ------------------------------------------------------------------ C */
await check(page, 'C. entrar no planeta por proximidade (sem clique), com continuidade e luas reveladas', async () => {
  await page.keyboard.press('c')
  await A.frames(90)
  const at = await A.screen(`p:${viagens}`)
  await page.mouse.move(at.x, at.y)
  await A.frames(5)
  await A.startRec()
  let peeked = false
  let maxReveal = 0
  let entered = null
  for (let i = 0; i < 40 && !entered; i++) {
    await A.wheel(at.x, at.y, -100, 1, 5, `p:${viagens}`)
    const s = await A.state()
    peeked ||= s.peek === viagens
    maxReveal = Math.max(maxReveal, s.reveal)
    if (s.level === 'planet') entered = s
  }
  await A.frames(60)
  const rec = await A.stopRec()
  assert(entered, 'não entrou no planeta com a roda')
  assert(entered.planetId === viagens, 'entrou no planeta errado')
  assert(peeked && maxReveal > 0.5, `as luas deveriam ser reveladas antes (peek=${peeked}, reveal=${maxReveal.toFixed(2)})`)
  const s = await A.state()
  assert(s.peek === null, 'peek deveria ser limpo após a entrada')
  // continuity through the hand-over (no flight, no re-frame)
  assert(maxStep(rec) < 0.05, `salto de câmera na entrada: ${maxStep(rec).toFixed(3)}`)
  const targetJump = (() => {
    let m = 0
    for (let i = 1; i < rec.target.length; i++) m = Math.max(m, api_dist(rec.target[i], rec.target[i - 1]) / Math.max(1, rec.dist[i]))
    return m
  })()
  assert(targetJump < 0.05, `salto do alvo na entrada: ${targetJump.toFixed(3)}`)
  await page.getByRole('button', { name: /^Grupo Roteiro/ }).waitFor({ state: 'attached' })
  await page.screenshot({ path: `${SHOTS}nav-C-entered.png` })
})

/* ------------------------------------------------------------------ D */
await check(page, 'D. histerese: pequenos afastamentos não saem; afastar de verdade volta ao universo', async () => {
  const s0 = await A.state()
  assert(s0.level === 'planet', 'precisa começar dentro do planeta')
  const cx = 550
  const cy = 340
  await A.wheel(cx, cy, 100, 2, 6)
  await A.frames(30)
  assert((await A.state()).level === 'planet', 'saiu cedo demais (sem histerese)')
  await A.startRec()
  let left = null
  for (let i = 0; i < 40 && !left; i++) {
    await A.wheel(cx, cy, 100, 1, 5)
    const s = await A.state()
    if (s.level === 'universe') left = s
  }
  await A.frames(90)
  const rec = await A.stopRec()
  assert(left, 'não voltou ao universo afastando')
  const s = await A.state()
  assert(s.level === 'universe' && s.planetId === null, 'deveria estar no universo')
  assert(maxStep(rec) < 0.05, `salto de câmera na saída: ${maxStep(rec).toFixed(3)}`)
  // after leaving, the user is far away: continuing to zoom OUT must not re-open anything
  await A.wheel(cx, cy, 100, 3, 5)
  await A.frames(40)
  assert((await A.state()).level === 'universe', 'reabriu sozinho')
  await A.frames(60)
  assert((await A.state()).peek === null, 'as luas deveriam ter sumido (peek limpo)')
})

/* ------------------------------------------------------------------ E */
await check(page, 'E. alternar entre planetas (dock, teclado e roda) mantém a câmera estável', async () => {
  await page.keyboard.press('c')
  await A.frames(80)
  await A.startRec()
  const order = ['1', '3', '2', '4', '1']
  for (const k of order) {
    await page.keyboard.press(k)
    await A.frames(110)
    const s = await A.state()
    assert(s.level === 'planet', `tecla ${k}: nível ${s.level}`)
    assert(Number.isFinite(s.dist) && s.pos.every(Number.isFinite), `tecla ${k}: câmera inválida`)
  }
  await page.keyboard.press('0')
  await A.frames(110)
  const rec = await A.stopRec()
  assert((await A.state()).level === 'universe', 'não voltou ao universo')
  assert(maxStep(rec) < 0.07, `salto na alternância: ${maxStep(rec).toFixed(3)}`)
  // then reach another planet with the wheel alone
  const trab = await A.planetId('Trabalho')
  const at = await A.screen(`p:${trab}`)
  await page.mouse.move(at.x, at.y)
  await A.frames(5)
  let ok = false
  for (let i = 0; i < 45 && !ok; i++) {
    await A.wheel(at.x, at.y, -100, 1, 5, `p:${trab}`)
    ok = (await A.state()).planetId === trab
  }
  assert(ok, 'não alcançou Trabalho pela roda')
})

/* ------------------------------------------------------------------ F */
await check(page, 'F. girar, deslocar e centralizar depois do zoom (sem pulos de alvo)', async () => {
  await page.keyboard.press('0')
  await A.frames(100)
  const at = await A.screen(`p:${viagens}`)
  await A.wheel(at.x, at.y, -100, 6, 5, `p:${viagens}`) // focus engaged, still outside the entry zone
  await A.frames(40)
  const before = await A.state()
  assert(before.level === 'universe' && before.focus.key, 'precisa estar com foco no universo')
  // rotate (left drag on empty space): the target must not jump when the focus is released
  await A.startRec()
  // empty canvas (no HUD, no label, no planet): top middle
  await page.mouse.move(620, 120)
  await page.mouse.down()
  await page.mouse.move(740, 100, { steps: 8 })
  await page.mouse.up()
  await A.frames(40)
  let rec = await A.stopRec()
  assert(maxStep(rec, 'target') < 0.03, `o alvo saltou ao girar: ${maxStep(rec, 'target').toFixed(3)}`)
  assert((await A.state()).focus.key === null, 'girar deveria soltar o foco do zoom')
  // pan (right drag)
  const t0 = (await A.state()).target
  await page.mouse.move(620, 140)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(740, 190, { steps: 8 })
  await page.mouse.up({ button: 'right' })
  await A.frames(40)
  const t1 = (await A.state()).target
  assert(A.dist3(t0, t1) > 0.5, 'a panorâmica não moveu o alvo')
  // keyboard pan + recenter
  await page.keyboard.press('ArrowLeft')
  await A.frames(30)
  await page.keyboard.press('c')
  await A.frames(110)
  const s = await A.state()
  assert(s.level === 'universe', 'centralizar não deve mudar o nível')
  assert(A.dist3(s.target, [0, 0, 0]) < 1.2, `alvo não voltou ao centro: ${s.target.map((v) => v.toFixed(1))}`)
  assert(s.dist > 50, `distância não voltou ao enquadramento (${s.dist.toFixed(1)})`)
  assert(s.focus.key === null, 'foco deveria estar limpo')
})

/* ------------------------------------------------------------------ G */
await check(page, 'G. painéis HTML continuam rolando com a roda (e a câmera não se mexe)', async () => {
  await page.getByRole('button', { name: /Ir para Trabalho/ }).click()
  await A.frames(100)
  await page.getByRole('button', { name: 'Grupo Auditorias' }).dispatchEvent('click')
  await A.frames(100)
  await page.getByRole('button', { name: /^Tarefa Corrigir/ }).dispatchEvent('click')
  await page.getByTestId('task-panel').waitFor()
  await A.frames(100)
  const panel = page.locator('[data-testid="task-panel"] .panel-body')
  const before = await A.state()
  const scrollable = await panel.evaluate((el) => el.scrollHeight > el.clientHeight + 20)
  assert(scrollable, 'o painel deveria ser rolável neste tamanho de janela')
  const box = await panel.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 400)
  await A.frames(12)
  const top = await panel.evaluate((el) => el.scrollTop)
  const after = await A.state()
  assert(top > 100, `painel não rolou (scrollTop=${top})`)
  assert(Math.abs(after.dist - before.dist) < 0.05, `a câmera reagiu à roda sobre o painel (${before.dist} → ${after.dist})`)
  // a textarea inside the panel scrolls itself too
  const ta = page.locator('[data-testid="task-panel"] textarea').first()
  await ta.evaluate((el) => (el.value = Array.from({ length: 40 }, (_, i) => `linha ${i}`).join('\n')))
  const tb = await ta.boundingBox()
  await ta.scrollIntoViewIfNeeded()
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
  await page.mouse.wheel(0, 120)
  await A.frames(8)
  assert(Math.abs((await A.state()).dist - after.dist) < 0.05, 'a câmera reagiu à roda sobre o formulário')
  await page.keyboard.press('Escape')
  await page.keyboard.press('0')
  await A.frames(100)
})

/* ------------------------------------------------------------------ H */
await check(page, 'H. o laboratório não sofre interferência da navegação automática', async () => {
  const at = await A.screen(`p:${viagens}`)
  await page.mouse.move(at.x, at.y)
  await A.frames(5)
  // build up zoom intent aimed at a planet, then open the lab in the middle of the gesture
  await A.wheel(at.x, at.y, -100, 4, 4, `p:${viagens}`)
  await page.keyboard.press('n')
  await page.getByTestId('planet-lab').waitFor()
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(800, 340)
    await page.mouse.wheel(0, -100)
    await A.frames(6)
  }
  await A.frames(60)
  const s = await A.state()
  assert(s.lab && s.planetId === null, `o laboratório foi interrompido (lab=${s.lab}, planeta=${s.planetId})`)
  assert(s.peek === null, 'peek vazou para dentro do laboratório')
  assert(s.focus.key === null, 'zoom no laboratório não deveria aninhar foco em objetos')
  const stage = await page.evaluate(() => window.__orbita.runtime.cam.target.toArray())
  assert(A.dist3(stage, [150, 6, -120]) < 1, `a câmera saiu da câmara de formação (${stage.map((v) => v.toFixed(1))})`)
  await page.getByText('Cancelar', { exact: true }).click()
  await A.frames(100)
  assert((await A.state()).level === 'universe', 'não voltou ao universo ao cancelar')
})

/* ------------------------------------------------------------------ K */
await check(page, 'K. o clique continua funcionando como alternativa independente', async () => {
  await page.keyboard.press('c')
  await A.frames(80)
  const at = await A.screen(`p:${viagens}`)
  await page.mouse.move(at.x, at.y)
  await A.frames(5)
  await page.mouse.down()
  await page.mouse.up()
  await A.frames(100)
  const s = await A.state()
  assert(s.level === 'planet' && s.planetId === viagens, `clique não abriu o planeta (${s.level})`)
  await page.keyboard.press('Escape')
  await A.frames(100)
  assert((await A.state()).level === 'universe', 'Esc não voltou')
})

/* ------------------------------------------------------------------ L */
await check(page, 'L. a câmera nunca atravessa a estrela nem um planeta, mesmo forçando o zoom', async () => {
  await page.keyboard.press('c')
  await A.frames(90)
  // 1) straight at the star
  const sunPx = await page.evaluate(() => {
    const r = window.__orbita.runtime
    const v = new r.cam.pos.constructor(0, 0, 0).project(r.camera)
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height }
  })
  await A.startRec()
  await A.wheel(sunPx.x, sunPx.y, -120, 30, 4)
  await A.frames(40)
  let rec = await A.stopRec()
  const sunClear = Math.min(...rec.pos.map((p) => Math.hypot(...p) / 4.2))
  assert(sunClear > 1.2, `a câmera entrou na estrela (folga mínima ${sunClear.toFixed(2)}× o raio)`)
  // 2) straight into a planet while "arrange" mode keeps proximity-entry off
  await page.keyboard.press('c')
  await A.frames(90)
  await page.keyboard.press('r')
  await A.frames(10)
  const R = await page.evaluate((id) => window.__orbita.runtime.size.get(`p:${id}`), viagens)
  const at = await A.screen(`p:${viagens}`)
  await A.startRec()
  await A.wheel(at.x, at.y, -120, 40, 4, `p:${viagens}`)
  await A.frames(40)
  rec = await A.stopRec()
  const pp = await page.evaluate((id) => window.__orbita.runtime.pos.get(`p:${id}`).toArray(), viagens)
  const planetClear = Math.min(...rec.pos.map((p) => A.dist3(p, pp) / R))
  assert(planetClear > 1.2, `a câmera entrou no planeta (folga mínima ${planetClear.toFixed(2)}× o raio)`)
  assert((await A.state()).level === 'universe', 'o modo reorganizar não deveria abrir categorias')
  await page.keyboard.press('r')
  await page.keyboard.press('c')
  await A.frames(90)
})

const fatalA = A.errors.filter((e) => !/THREE\.Clock|DevTools/.test(e))
await check(page, 'nenhum erro de console nos cenários A–H e K', async () => {
  assert(fatalA.length === 0, fatalA.slice(0, 3).join(' | '))
})
await page.context().close()

/* ------------------------------------------------------------------ I */
const R = await boot({ reducedMotion: true, effects: 'Mínimo' })
await check(R.page, 'I. movimento reduzido: órbitas paradas, zoom-ao-cursor e entrada por proximidade seguem funcionando', async () => {
  const flags = await R.page.evaluate(() => ({ r: window.__orbita.runtime.reducedMotion, tU: window.__orbita.runtime.tU }))
  assert(flags.r === true, 'movimento reduzido não detectado')
  await R.frames(20)
  assert((await R.page.evaluate(() => window.__orbita.runtime.tU)) === flags.tU, 'as órbitas não deveriam avançar')
  const id = await R.planetId('Viagens')
  const at = await R.screen(`p:${id}`)
  await R.page.mouse.move(at.x, at.y)
  await R.frames(5)
  let entered = false
  for (let i = 0; i < 45 && !entered; i++) {
    await R.wheel(at.x, at.y, -100, 1, 4, `p:${id}`)
    entered = (await R.state()).planetId === id
  }
  assert(entered, 'não entrou por proximidade com movimento reduzido')
  // with reduced motion the camera settles immediately (no cinematic glide)
  await R.frames(8)
  const a = await R.state()
  await R.frames(8)
  const b = await R.state()
  assert(R.dist3(a.pos, b.pos) < 0.2, 'câmera ainda deslizando com movimento reduzido')
  await R.wheel(550, 340, 100, 45, 4)
  await R.frames(10)
  assert((await R.state()).level === 'universe', 'não saiu por afastamento com movimento reduzido')
})
const fatalR = R.errors.filter((e) => !/THREE\.Clock|DevTools/.test(e))
await check(R.page, 'nenhum erro de console com movimento reduzido', async () => {
  assert(fatalR.length === 0, fatalR.slice(0, 3).join(' | '))
})

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} verificações de navegação passaram`)
process.exit(failed.length ? 1 : 0)
