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

/** Replaces the data with a synthetic universe cloned from the example one. */
export async function synth(page, { planets, groups, tasks, name = 'Sintético' }) {
  await page.evaluate(
    ({ planets, groups, tasks }) => {
      const o = window.__orbita
      const base = o.dataStore.get().data
      const tpl = base.planets[0]
      const colors = ['#7fb4ff', '#e0a24c', '#9fe3c8', '#c7a6e8', '#ff8d80', '#e9c98d', '#8fd0ff']
      const prios = ['critical', 'high', 'medium', 'low']
      const stat = ['todo', 'doing', 'todo', 'blocked', 'todo', 'done']
      const today = new Date()
      const day = (d) => new Date(today.getTime() + d * 86400000).toISOString().slice(0, 10)
      const P = []
      const G = []
      const T = []
      let k = 0
      for (let i = 0; i < planets; i++) {
        const pid = `sp${i}`
        const lane = Math.floor(i / 8)
        const inLane = Math.min(8, planets - lane * 8)
        P.push({
          ...structuredClone(tpl),
          id: pid,
          name: i === 0 ? 'Planeta Alfa' : `Planeta ${i + 1}`,
          symbol: ['◐', '✦', '⌂', '✎', '⚙', '✈'][i % 6],
          lane,
          phase: ((i % 8) / inLane) * Math.PI * 2,
          order: i,
          style: { ...structuredClone(tpl.style), seed: 100 + i * 17, size: 0.9 + (i % 4) * 0.12 },
        })
        for (let j = 0; j < groups; j++) {
          const gid = `sg${i}_${j}`
          G.push({
            id: gid,
            planetId: pid,
            name: ['Reuniões', 'Relatórios', 'Auditorias', 'Compras', 'Projetos', 'Clientes', 'Equipe'][j % 7],
            description: '',
            symbol: '',
            color: colors[j % colors.length],
            kind: 'auto',
            order: j,
            createdAt: 1,
            updatedAt: 1,
          })
          const count = Array.isArray(tasks) ? (i === 0 ? tasks[j % tasks.length] : 3) : tasks
          for (let t = 0; t < count; t++, k++) {
            const done = stat[k % stat.length] === 'done'
            T.push({
              id: `st${k}`,
              planetId: pid,
              groupId: gid,
              title: `${['Revisar', 'Enviar', 'Aprovar', 'Cotar', 'Agendar', 'Fechar'][k % 6]} ${['contrato', 'proposta', 'laudo', 'pedido', 'agenda', 'balanço'][(k * 7) % 6]} ${k + 1}`,
              description: '',
              dueDate: done ? null : day(((k * 5) % 21) - 4),
              dueTime: null,
              priority: prios[(k * 3) % 4],
              status: stat[k % stat.length],
              subtasks: [],
              notes: [],
              links: [],
              completedAt: done ? Date.now() - 86400000 : null,
              createdAt: 1000 + k,
              updatedAt: 1000 + k,
            })
          }
        }
      }
      o.uiStore.set({ planetId: null, groupId: null, taskId: null, taskPanel: null, hover: null, peekPlanetId: null })
      o.dataStore.set({ data: { ...base, planets: P, groups: G, tasks: T } })
    },
    { planets, groups, tasks },
  )
  await page.waitForFunction((n) => {
    const o = window.__orbita
    return o.dataStore.get().data.planets.length === n && o.dataStore.get().data.planets.every((p) => o.runtime.pos.has(`p:${p.id}`))
  }, planets)
}

