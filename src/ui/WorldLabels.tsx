import { useEffect, useMemo, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { goGroup, goPlanet, selectTask } from '../state/commands'
import { dataStore } from '../state/dataStore'
import { levelOf, uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { clockStore } from '../state/clock'
import { haloContent, labelBudget, pickOverview, rankTasks, satelliteCap } from '../domain/overview'
import { groupsOfPlanet, sortedPlanets, statsOf, tasksOfGroup, tasksOfPlanet } from '../domain/stats'
import { PRIORITY_LABEL } from '../domain/types'
import { useQualityTier } from '../scene/useQuality'
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
  /** small count shown after the text ("+3" hidden tasks, open tasks of a planet) */
  badge?: string
  /** badge/accent colour (group colour for tasks, alert colour for planets) */
  accent?: string
  alert?: boolean
  /** group this label belongs to: hovering the group reveals all of its labels */
  group?: string
  /** halo tasks: true = written with the summary; overview tasks use `limit` instead */
  budgeted?: boolean
  /** overview tasks: at most this many names are written at once (those that fit, by rank) */
  limit?: number
  /** hidden while the view shows fewer than `gateMin` pixels per world unit at this anchor (too far to read) */
  gate?: string
  gateMin?: number
  /** summary-halo label: visible in proportion to the planet's halo level */
  haloOf?: string
}

const v = new Vector3()
const v2 = new Vector3()

/**
 * HTML labels glued to 3D anchors. Positions are written imperatively every frame
 * (no React re-render); overlapping labels are culled by priority.
 *
 * Seen from a planet, the tasks of every group are written next to their satellites, but only as many
 * as the label budget allows (urgent / in progress first); hovering a moon spells out all of its tasks.
 */
export function WorldLabels() {
  const data = useStore(dataStore, (s) => s.data)
  const now = useStore(clockStore, (s) => s.now)
  const ui = useStore(uiStore, (s) => ({ planetId: s.planetId, groupId: s.groupId, taskId: s.taskId, lab: s.lab !== null }))
  const haloPlanets = useStore(uiStore, (s) => s.haloLabelPlanets)
  const tier = useQualityTier()
  const level = levelOf(ui)
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  useEffect(() => {
    const on = () => setWidth(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  const specs = useMemo<Spec[]>(() => {
    if (ui.lab) return []
    const out: Spec[] = []
    const showAll = data.settings.showLabels
    if (level === 'universe') {
      for (const p of sortedPlanets(data.planets)) {
        const st = statsOf(tasksOfPlanet(data.tasks, p.id), now)
        const open = st.total - st.done
        out.push({
          key: `p:${p.id}`,
          anchor: `p:${p.id}`,
          kind: 'planet',
          text: p.name,
          symbol: p.symbol,
          badge: open > 0 ? String(open) : undefined,
          alert: st.overdueCount > 0,
          priority: showAll ? 50 : -1,
          onClick: () => goPlanet(p.id),
          ref: { kind: 'planet', id: p.id },
        })
      }
      // in-scene summary of the planets being hovered / approached
      for (const id of haloPlanets) {
        const groups = groupsOfPlanet(data.groups, id)
        const content = haloContent(groups, tasksOfPlanet(data.tasks, id), now)
        content.forEach((c) => {
          out.push({
            key: `hg:${c.group.id}`,
            anchor: `hg:${c.group.id}`,
            kind: 'group',
            text: c.group.name,
            color: c.group.color,
            badge: c.more > 0 ? `+${c.more}` : undefined,
            accent: c.group.color,
            priority: 36,
            haloOf: id,
          })
          c.tasks.forEach((t, k) =>
            out.push({
              key: `ht:${t.id}`,
              anchor: `ht:${t.id}`,
              kind: 'task',
              text: t.title,
              color: STATUS_COLOR[t.status],
              accent: c.group.color,
              priority: 24 - k,
              haloOf: id,
              budgeted: k < 2,
              group: c.group.id,
            }),
          )
        })
      }
    } else if (ui.planetId) {
      const planetGroups = groupsOfPlanet(data.groups, ui.planetId)
      // inside a group only that group stays on screen; the other moons are hidden in the scene
      const visibleGroups = planetGroups.filter((x) => !ui.groupId || x.id === ui.groupId)
      const cap = satelliteCap(planetGroups.length, tier)
      const shownByGroup = new Map<string, ReturnType<typeof pickOverview>>()
      for (const g of visibleGroups) {
        const all = tasksOfGroup(data.tasks, g.id)
        shownByGroup.set(g.id, ui.groupId === g.id ? all : pickOverview(all, cap, now))
      }
      for (const g of visibleGroups) {
        const total = tasksOfGroup(data.tasks, g.id).length
        const hidden = total - (shownByGroup.get(g.id)?.length ?? 0)
        out.push({
          key: `g:${g.id}`,
          anchor: `g:${g.id}`,
          kind: 'group',
          text: g.name,
          symbol: g.symbol || undefined,
          color: g.color,
          accent: g.color,
          badge: !ui.groupId && hidden > 0 ? `+${hidden}` : undefined,
          priority: ui.groupId === g.id ? 60 : showAll ? 40 : -1,
          onClick: () => goGroup(g.id),
          ref: { kind: 'group', id: g.id },
        })
      }
      if (ui.groupId) {
        const tasks = shownByGroup.get(ui.groupId) ?? []
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
            out.push({ key: `b:${ui.groupId}:${band}`, anchor: `b:${ui.groupId}:${band}`, kind: 'band', text: PRIORITY_LABEL[band], priority: 70 })
        if (tasks.some((t) => t.status === 'done')) out.push({ key: `b:${ui.groupId}:done`, anchor: `b:${ui.groupId}:done`, kind: 'band', text: 'Concluídas', priority: 70 })
      } else {
        // every group's most important tasks, written beside their satellites: the most important ones
        // that fit, up to a budget that depends on how many there are and on the screen width
        const all = visibleGroups.flatMap((g) => (shownByGroup.get(g.id) ?? []).map((t) => ({ t, g })))
        const limit = labelBudget(all.length, width)
        const order = new Map(rankTasks(all.map((x) => x.t), now).map((t, i) => [t.id, i]))
        for (const { t, g } of all)
          out.push({
            key: `t:${t.id}`,
            anchor: `t:${t.id}`,
            kind: 'task',
            text: t.title,
            color: STATUS_COLOR[t.status],
            accent: g.color,
            done: t.status === 'done',
            priority: 30 - Math.min(20, (order.get(t.id) ?? 0) * 0.5),
            limit,
            group: g.id,
            gate: `g:${g.id}`,
            gateMin: 8,
            onClick: () => selectTask(t.id),
            ref: { kind: 'task', id: t.id },
          })
      }
    }
    return out
  }, [data, now, ui.lab, ui.planetId, ui.groupId, level, haloPlanets, tier, width])

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
      const pxOf = (key: string, dist: number) => ((runtime.size.get(key) ?? 0.5) * (H / 2)) / (dist * tanHalf)
      const hoverGroup = state.hover?.kind === 'group' ? state.hover.id : null
      // the names of the moon under the cursor go first; those of its neighbours step aside
      const rankOf = (s: Spec) => s.priority + (s.kind === 'task' && !s.haloOf && hoverGroup && s.group === hoverGroup ? 100 : 0)
      const items = specsRef.current
        .map((s) => {
          const p = runtime.pos.get(s.anchor)
          if (!p) return null
          v.copy(p).project(cam)
          const dist = cam.position.distanceTo(p)
          const hot =
            (s.ref && state.hover && state.hover.kind === s.ref.kind && state.hover.id === s.ref.id) ||
            (s.kind === 'task' && state.taskId === s.ref?.id)
          let gx: number | null = null
          let gy: number | null = null
          if (s.gate) {
            const gp = runtime.pos.get(s.gate)
            if (gp) {
              v2.copy(gp).project(cam)
              gx = (v2.x * 0.5 + 0.5) * W
              gy = (-v2.y * 0.5 + 0.5) * H
            }
          }
          return { s, nx: v.x, ny: v.y, nz: v.z, dist, hot: !!hot, gx, gy }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => Number(b.hot) - Number(a.hot) || rankOf(b.s) - rankOf(a.s) || a.dist - b.dist)

      const visible = new Set<string>()
      let overviewShown = 0
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
        const pxR = pxOf(it.s.anchor, it.dist)
        const isBand = it.s.kind === 'band'
        // names of overview tasks fan out radially from their moon (left/right/above/below the satellite),
        // which keeps neighbours apart and leaves the area under each moon to its group name
        const radial = it.s.kind === 'task' && it.s.limit !== undefined && it.gx !== null
        let lx = x - sz.w / 2
        let ly = isBand ? y : y + pxR + 12
        if (radial) {
          const dx = x - it.gx!
          const dy = y - it.gy!
          if (Math.abs(dx) > Math.abs(dy) * 0.6) {
            lx = dx > 0 ? x + pxR + 7 : x - pxR - 7 - sz.w
            ly = y - sz.h / 2
          } else {
            ly = dy < 0 ? y - pxR - sz.h - 7 : y + pxR + 7
          }
        }
        const x0 = lx - 4
        const x1 = lx + sz.w + 4
        const y0 = ly - 2
        const y1 = ly + sz.h + 2
        const revealed = !!it.s.group && it.s.group === hoverGroup
        let show = !behind && it.s.priority >= 0
        if (it.hot || el === focused) show = !behind
        if (show && it.s.kind === 'task' && !it.hot && state.groupId && !it.s.haloOf) {
          // many satellites: only show prominent labels when zoomed out
          show = pxR > 5
        }
        if (show && it.s.kind === 'task' && !it.s.haloOf && !state.groupId && !it.hot && el !== focused) {
          // overview: budgeted names, or every name of the moon under the cursor; never when too far to read
          show = hoverGroup ? revealed : overviewShown < (it.s.limit ?? 0)
          if (show && it.s.gate) {
            // pixels per world unit at the group: names vanish only when zoomed out beyond reading
            const gp = runtime.pos.get(it.s.gate)
            const ppu = gp ? (H / 2) / (cam.position.distanceTo(gp) * tanHalf) : 0
            if (ppu < (it.s.gateMin ?? 0)) show = false
          }
        }
        let fade = 1
        if (it.s.haloOf) {
          const level = runtime.halo.get(it.s.haloOf) ?? 0
          fade = Math.min(1, Math.max(0, (level - 0.7) / 0.3))
          if (it.s.kind === 'task' && !it.s.budgeted) show = false
          if (fade <= 0.02) show = false
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
          if (it.s.kind === 'task' && it.s.limit !== undefined && !it.hot) overviewShown++
          placed.push({ x0, y0, x1, y1 })
          visible.add(it.s.key)
          el.style.transform = `translate3d(${Math.round(lx)}px, ${Math.round(ly)}px, 0)`
          el.classList.toggle('hot', it.hot)
          el.style.opacity = fade < 1 ? String(fade) : ''
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
        const cls = `wl ${s.kind} ${s.onClick ? 'interactive' : ''} ${s.done ? 'done' : ''} ${s.haloOf ? 'halo' : ''} hidden`
        const content = (
          <>
            {s.kind === 'task' && <span className="pip" style={{ background: s.color }} />}
            {s.kind === 'group' && !s.symbol && <span className="pip" style={{ background: s.color }} />}
            {s.symbol && <span className="sym" style={s.kind === 'group' ? { color: s.color } : undefined}>{s.symbol}</span>}
            <span className="txt">{s.text}</span>
            {s.badge && (
              <span className={`badge ${s.alert ? 'alert' : ''}`} style={!s.alert && s.accent ? { color: s.accent } : undefined}>
                {s.badge}
              </span>
            )}
          </>
        )
        const style = s.kind === 'task' && s.accent ? { borderLeftColor: s.accent } : undefined
        return s.onClick ? (
          <button
            key={s.key}
            ref={(el) => {
              if (el) els.current.set(s.key, el)
              else els.current.delete(s.key)
            }}
            className={cls}
            style={style}
            onClick={s.onClick}
            aria-label={`${s.kind === 'planet' ? 'Planeta' : s.kind === 'group' ? 'Grupo' : 'Tarefa'} ${s.text}${s.badge ? ` (${s.badge})` : ''}`}
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
            style={style}
            aria-hidden="true"
          >
            {content}
          </span>
        )
      })}
    </div>
  )
}
