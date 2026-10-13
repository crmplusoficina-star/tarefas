import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function loadPlaywright() {
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

/** Software WebGL so the checks also run on machines without a GPU. */
export const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

/**
 * Records the camera pose and its clearance to scene objects every frame.
 * Needs a dev build (window.__orbita). Read later with `page.evaluate(() => window.__rec)`.
 */
export const RECORDER = () => {
  const o = window.__orbita
  const rec = { frames: [], marks: [] }
  window.__rec = rec
  const loop = () => {
    const r = o.runtime
    const ui = o.uiStore.get()
    const cam = r.cam.pos
    const clear = []
    const test = (key, label) => {
      const p = r.pos.get(key)
      const R = r.size.get(key)
      if (p && R) clear.push([label, cam.distanceTo(p) / R])
    }
    clear.push(['sun', cam.length() / 4.2])
    if (ui.planetId) test(`p:${ui.planetId}`, 'planet')
    else for (const k of r.pos.keys()) if (k.startsWith('p:')) test(k, 'planet')
    for (const k of r.pos.keys()) if (k.startsWith('g:') || k.startsWith('t:')) test(k, k[0] === 'g' ? 'moon' : 'sat')
    rec.frames.push({
      t: performance.now(),
      pos: cam.toArray(),
      target: r.cam.target.toArray(),
      dist: r.cam.dist,
      clear,
      level: ui.taskId ? 'task' : ui.groupId ? 'group' : ui.planetId ? 'planet' : 'universe',
    })
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  window.__mark = (name) => rec.marks.push({ name, i: rec.frames.length, t: performance.now() })
}

/** Summarise a recording: jumps, direction changes and the closest approach to objects. */
export function analyse(rec) {
  const f = rec.frames
  const out = []
  for (let m = 0; m < rec.marks.length - 1; m++) {
    const a = rec.marks[m]
    const b = rec.marks[m + 1]
    const seg = f.slice(a.i, b.i)
    if (seg.length < 4) {
      out.push({ phase: a.name, frames: seg.length })
      continue
    }
    const steps = []
    const tsteps = []
    for (let i = 1; i < seg.length; i++) {
      const dp = Math.hypot(...seg[i].pos.map((v, k) => v - seg[i - 1].pos[k]))
      const dt = Math.hypot(...seg[i].target.map((v, k) => v - seg[i - 1].target[k]))
      steps.push(dp / Math.max(1, seg[i].dist))
      tsteps.push(dt / Math.max(1, seg[i].dist))
    }
    const sorted = [...steps].sort((x, y) => x - y)
    const med = sorted[Math.floor(sorted.length / 2)] || 1e-9
    const maxStep = Math.max(...steps)
    const worst = {}
    for (const fr of seg) for (const [label, ratio] of fr.clear) worst[label] = Math.min(worst[label] ?? Infinity, ratio)
    // heading change between consecutive frames (view direction = target - pos)
    let maxTurn = 0
    for (let i = 1; i < seg.length; i++) {
      const d = (s) => {
        const v = s.target.map((x, k) => x - s.pos[k])
        const n = Math.hypot(...v) || 1
        return v.map((x) => x / n)
      }
      const u = d(seg[i - 1])
      const w = d(seg[i])
      maxTurn = Math.max(maxTurn, Math.acos(Math.min(1, Math.max(-1, u[0] * w[0] + u[1] * w[1] + u[2] * w[2]))))
    }
    // smoothness: largest change of speed between two consecutive frames, relative to the peak speed
    const peak = Math.max(...steps) || 1
    let maxJerk = 0
    for (let i = 1; i < steps.length; i++) maxJerk = Math.max(maxJerk, Math.abs(steps[i] - steps[i - 1]) / peak)
    out.push({
      phase: a.name,
      frames: seg.length,
      maxStepPerDist: +maxStep.toFixed(4),
      medianStepPerDist: +med.toFixed(4),
      speedJump: +maxJerk.toFixed(2),
      maxTargetStepPerDist: +Math.max(...tsteps).toFixed(4),
      maxTurnDeg: +((maxTurn * 180) / Math.PI).toFixed(2),
      minClearance: Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toFixed(2)])),
    })
  }
  return out
}
