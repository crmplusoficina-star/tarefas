const BASE = process.env.ORBITA_URL ?? 'http://127.0.0.1:5173/'

/** Opens the app with the example universe and returns helpers (frames, screen(), state()…). Dev server only. */
export async function boot(browser, { reducedMotion = false, effects = 'Equilibrado', viewport = { width: 1100, height: 680 } } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(BASE)
  await page.getByTestId('empty-universe').waitFor({ timeout: 30000 })
  await page.getByTestId('settings-btn').click()
  await page.getByRole('button', { name: effects }).click()
  await page.getByRole('button', { name: 'Concluir' }).click()
  await page.getByRole('button', { name: /universo de exemplo/ }).click()
  await page.getByRole('button', { name: /Ir para Trabalho/ }).waitFor()
  await page.evaluate(() => {
    window.__orbita.runtime.fixedDt = 1 / 30
  })
  // the 3D nodes register their anchors on their first frames: wait for the whole system
  await page.waitForFunction(() => {
    const o = window.__orbita
    return o.dataStore.get().data.planets.every((p) => o.runtime.pos.has(`p:${p.id}`)) && o.runtime.camera !== null
  })
  const api = {
    page,
    errors,
    frames: (k) =>
      page.evaluate(
        (k) =>
          new Promise((res) => {
            let i = 0
            const f = () => (++i >= k ? res() : requestAnimationFrame(f))
            f()
          }),
        k,
      ),
    /** snapshot of everything the checks care about */
    state: () =>
      page.evaluate(() => {
        const o = window.__orbita
        const r = o.runtime
        const u = o.uiStore.get()
        return {
          level: u.taskId ? 'task' : u.groupId ? 'group' : u.planetId ? 'planet' : u.lab ? 'lab' : 'universe',
          planetId: u.planetId,
          groupId: u.groupId,
          peek: u.peekPlanetId,
          lab: !!u.lab,
          dist: r.cam.dist,
          reveal: r.reveal,
          focus: { ...r.zoomFocus },
          pos: r.cam.pos.toArray(),
          target: r.cam.target.toArray(),
        }
      }),
    planetId: (name) => page.evaluate((n) => window.__orbita.dataStore.get().data.planets.find((p) => p.name === n).id, name),
    /** pixel position of a registered anchor */
    screen: (key) =>
      page.evaluate((k) => {
        const r = window.__orbita.runtime
        const v = r.pos.get(k).clone().project(r.camera)
        return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height }
      }, key),
    /** world point on the ground plane under a pixel (null if none) */
    ground: (x, y) =>
      page.evaluate(
        ([x, y]) => {
          const r = window.__orbita.runtime
          const cam = r.camera
          const o = cam.position.clone()
          const nx = (x / r.width) * 2 - 1
          const ny = -(y / r.height) * 2 + 1
          const d = new o.constructor(nx, ny, 0.5).unproject(cam).sub(o).normalize()
          if (Math.abs(d.y) < 1e-3) return null
          const t = -o.y / d.y
          return t > 0 ? [o.x + d.x * t, 0, o.z + d.z * t] : null
        },
        [x, y],
      ),
    dist3: (a, b) => Math.hypot(...a.map((v, i) => v - b[i])),
    /** record camera motion between start() and stop(): returns per-frame steps */
    startRec: () =>
      page.evaluate(() => {
        const r = window.__orbita.runtime
        const rec = { pos: [], target: [], dist: [], on: true }
        window.__navrec = rec
        const loop = () => {
          if (!rec.on) return
          rec.pos.push(r.cam.pos.toArray())
          rec.target.push(r.cam.target.toArray())
          rec.dist.push(r.cam.dist)
          requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
      }),
    stopRec: () =>
      page.evaluate(() => {
        window.__navrec.on = false
        return window.__navrec
      }),
    wheel: async (x, y, dy, count, framesBetween = 5, follow) => {
      for (let i = 0; i < count; i++) {
        if (follow) {
          const p = await api.screen(follow)
          x = p.x
          y = p.y
        }
        await page.mouse.move(x, y)
        await page.mouse.wheel(0, dy)
        await api.frames(framesBetween)
      }
    },
  }
  await api.frames(60)
  return api
}
