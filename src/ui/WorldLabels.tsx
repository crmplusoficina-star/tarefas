import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { goGroup, goPlanet, selectTask } from '../state/commands'
import { dataStore } from '../state/dataStore'
import { levelOf, uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { groupsOfPlanet, sortedPlanets } from '../domain/stats'
import { PRIORITY_LABEL } from '../domain/types'
import { cameraControl } from '../scene/cameraControl'
import { runtime } from '../scene/runtime'
import { STATUS_COLOR } from '../scene/Satellites'

interface Spec {
  key: string
  anchor: string
  kind: 'planet' | 'group' | 'task' | 'band'
  text: string
  symbol?: string
  color?: string
  done?: boolean
  priority: number
  onClick?: () => void
  /** hover/select id used to promote the label */
  ref?: { kind: 'planet' | 'group' | 'task'; id: string }
}

const v = new Vector3()

/**
 * HTML labels glued to 3D anchors. Positions are written imperatively every frame
 * (no React re-render); overlapping labels are culled by priority.
 */
export function WorldLabels() {
  const data = useStore(dataStore, (s) => s.data)
  const ui = useStore(uiStore, (s) => ({ planetId: s.planetId, groupId: s.groupId, taskId: s.taskId, lab: s.lab !== null }))
  const level = levelOf(ui)

  const specs = useMemo<Spec[]>(() => {
    if (ui.lab) return []
    const out: Spec[] = []
    const showAll = data.settings.showLabels
    if (level === 'universe') {
      for (const p of sortedPlanets(data.planets))
        out.push({
          key: `p:${p.id}`,
          anchor: `p:${p.id}`,
          kind: 'planet',
          text: p.name,
          symbol: p.symbol,
          priority: showAll ? 50 : -1,
          onClick: () => goPlanet(p.id),
          ref: { kind: 'planet', id: p.id },
        })
    } else if (ui.planetId) {
      // inside a group only that group stays on screen; the other moons are hidden in the scene
      for (const g of groupsOfPlanet(data.groups, ui.planetId).filter((x) => !ui.groupId || x.id === ui.groupId))
        out.push({
          key: `g:${g.id}`,
          anchor: `g:${g.id}`,
          kind: 'group',
          text: g.name,
          symbol: g.symbol || undefined,
          color: g.color,
          priority: ui.groupId === g.id ? 60 : showAll ? 40 : -1,
          onClick: () => goGroup(g.id),
          ref: { kind: 'group', id: g.id },
        })
      if (ui.groupId) {
        const tasks = data.tasks.filter((t) => t.groupId === ui.groupId)
        for (const t of tasks)
          out.push({
            key: `t:${t.id}`,
            anchor: `t:${t.id}`,
            kind: 'task',
            text: t.title,
            color: STATUS_COLOR[t.status],
            done: t.status === 'done',
            priority: (t.status === 'done' ? 0 : 20) + (t.priority === 'critical' ? 8 : t.priority === 'high' ? 5 : t.priority === 'medium' ? 2 : 0),
            onClick: () => selectTask(t.id),
            ref: { kind: 'task', id: t.id },
          })
        for (const band of ['critical', 'high', 'medium', 'low'] as const)
          if (tasks.some((t) => t.status !== 'done' && t.priority === band))
            out.push({ key: `b:${band}`, anchor: `b:${band}`, kind: 'band', text: PRIORITY_LABEL[band], priority: 70 })
        if (tasks.some((t) => t.status === 'done')) out.push({ key: 'b:done', anchor: 'b:done', kind: 'band', text: 'Concluídas', priority: 70 })
      }
    }
    return out
  }, [data, ui.lab, ui.planetId, ui.groupId, level])

  const els = useRef(new Map<string, HTMLElement>())
  const specsRef = useRef(specs)
  specsRef.current = specs
  const box = useRef<HTMLDivElement>(null)

  // labels sit above the canvas: keep wheel zoom working when the cursor is over one
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      cameraControl.wheel(e.clientX, e.clientY, e.deltaY, e.deltaMode)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    let raf = 0
    const sizes = new Map<string, { w: number; h: number }>()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const cam = runtime.camera
      const W = box.current?.clientWidth ?? runtime.width
      const H = box.current?.clientHeight ?? runtime.height
      if (!cam || !W) return
      const state = uiStore.get()
      const focused = document.activeElement
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = []
      const tanHalf = Math.tan((cam.fov * Math.PI) / 360)
      const items = specsRef.current
        .map((s) => {
          const p = runtime.pos.get(s.anchor)
          if (!p) return null
          v.copy(p).project(cam)
          const dist = cam.position.distanceTo(p)
          const hot =
            (s.ref && state.hover && state.hover.kind === s.ref.kind && state.hover.id === s.ref.id) ||
            (s.kind === 'task' && state.taskId === s.ref?.id)
          return { s, nx: v.x, ny: v.y, nz: v.z, dist, hot: !!hot }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => Number(b.hot) - Number(a.hot) || b.s.priority - a.s.priority || a.dist - b.dist)

      const visible = new Set<string>()
      for (const it of items) {
        const el = els.current.get(it.s.key)
        if (!el) continue
        let sz = sizes.get(it.s.key)
        if (!sz || sz.w === 0) {
          sz = { w: el.offsetWidth, h: el.offsetHeight }
          sizes.set(it.s.key, sz)
        }
        const behind = it.nz > 1 || it.nz < -1
        const x = (it.nx * 0.5 + 0.5) * W
        const y = (-it.ny * 0.5 + 0.5) * H
        const world = runtime.size.get(it.s.anchor) ?? 0.5
        const pxR = (world * (H / 2)) / (it.dist * tanHalf)
        const isBand = it.s.kind === 'band'
        const ly = isBand ? y : y + pxR + 12
        const x0 = x - sz.w / 2 - 4
        const x1 = x + sz.w / 2 + 4
        const y0 = ly - 2
        const y1 = ly + sz.h + 2
        let show = !behind && it.s.priority >= 0
        if (it.hot || el === focused) show = !behind
        if (show && it.s.kind === 'task' && !it.hot && state.groupId) {
          // many satellites: only show prominent labels when zoomed out
          show = pxR > 5
        }
        if (show && !it.hot && el !== focused) {
          for (const r of placed) {
            if (x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0) {
              show = false
              break
            }
          }
        }
        if (show) {
          placed.push({ x0, y0, x1, y1 })
          visible.add(it.s.key)
          el.style.transform = `translate3d(${Math.round(x - sz.w / 2)}px, ${Math.round(ly)}px, 0)`
          el.classList.toggle('hot', it.hot)
        }
        el.classList.toggle('hidden', !show)
        if (!show) el.tabIndex = -1
        else el.removeAttribute('tabindex')
      }
      // labels whose anchor does not exist yet stay hidden
      for (const [k, el] of els.current) if (!visible.has(k) && !items.some((i) => i.s.key === k)) el.classList.add('hidden')
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="labels" ref={box} aria-label="Objetos do mapa">
      {specs.map((s) => {
        const cls = `wl ${s.kind} ${s.onClick ? 'interactive' : ''} ${s.done ? 'done' : ''} hidden`
        const content = (
          <>
            {s.kind === 'task' && <span className="pip" style={{ background: s.color }} />}
            {s.kind === 'group' && !s.symbol && <span className="pip" style={{ background: s.color }} />}
            {s.symbol && <span className="sym" style={s.kind === 'group' ? { color: s.color } : undefined}>{s.symbol}</span>}
            <span>{s.text}</span>
          </>
        )
        return s.onClick ? (
          <button
            key={s.key}
            ref={(el) => {
              if (el) els.current.set(s.key, el)
              else els.current.delete(s.key)
            }}
            className={cls}
            onClick={s.onClick}
            aria-label={`${s.kind === 'planet' ? 'Planeta' : s.kind === 'group' ? 'Grupo' : 'Tarefa'} ${s.text}`}
          >
            {content}
          </button>
        ) : (
          <span
            key={s.key}
            ref={(el) => {
              if (el) els.current.set(s.key, el)
              else els.current.delete(s.key)
            }}
            className={cls}
            aria-hidden="true"
          >
            {content}
          </span>
        )
      })}
    </div>
  )
}
