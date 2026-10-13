import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { statsOf, tasksOfPlanet } from '../domain/stats'
import { describeDue } from '../domain/time'
import { PRIORITY_LABEL, STATUS_LABEL } from '../domain/types'
import { clockStore } from '../state/clock'
import { dataStore } from '../state/dataStore'
import { uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { runtime } from '../scene/runtime'
import { STATUS_COLOR } from '../scene/Satellites'

const v = new Vector3()

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function HoverCard() {
  const hover = useStore(uiStore, (s) => s.hover)
  const lab = useStore(uiStore, (s) => s.lab !== null)
  const arrange = useStore(uiStore, (s) => s.mode === 'arrange')
  const data = useStore(dataStore, (s) => s.data)
  const now = useStore(clockStore, (s) => s.now)
  const ref = useRef<HTMLDivElement>(null)
  const key = hover ? `${hover.kind === 'planet' ? 'p' : hover.kind === 'group' ? 'g' : 't'}:${hover.id}` : null

  useEffect(() => {
    if (!key) return
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const cam = runtime.camera
      const el = ref.current
      const p = runtime.pos.get(key)
      if (!cam || !el || !p) return
      v.copy(p).project(cam)
      const W = runtime.width
      const H = runtime.height
      const x = (v.x * 0.5 + 0.5) * W
      const y = (-v.y * 0.5 + 0.5) * H
      const dist = cam.position.distanceTo(p)
      const pxR = ((runtime.size.get(key) ?? 0.5) * (H / 2)) / (dist * Math.tan((cam.fov * Math.PI) / 360))
      const w = el.offsetWidth
      const h = el.offsetHeight
      let px = x + pxR + 16
      if (px + w > W - 16) px = x - pxR - 16 - w
      const py = Math.min(H - h - 16, Math.max(16, y - h / 2))
      el.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0)`
      el.style.visibility = 'visible'
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [key])

  // planets and moons are explained inside the scene (PlanetHalo, satellites with names); a card is only kept for rearranging and for single tasks
  if (!hover || lab || (hover.kind === 'planet' && !arrange) || hover.kind === 'group') return null
  let body: React.ReactNode

  if (hover.kind === 'planet') {
    const p = data.planets.find((x) => x.id === hover.id)
    if (!p) return null
    const tasks = tasksOfPlanet(data.tasks, p.id)
    const st = statsOf(tasks, now)
    const groups = data.groups.filter((g) => g.planetId === p.id).length
    body = (
      <>
        <div className="hc-head">
          <span className="sym">{p.symbol}</span>
          <span className="hc-title">{p.name}</span>
        </div>
        <div className="hc-sub">
          {plural(groups, 'grupo orbital', 'grupos orbitais')} · {plural(st.total, 'tarefa', 'tarefas')}
        </div>
        {p.description && <div className="hc-desc">{p.description}</div>}
        {st.total > 0 && (
          <div className="hc-meter" aria-hidden="true">
            <i style={{ width: `${Math.round(st.progress * 100)}%` }} />
          </div>
        )}
        <div className="hc-row">
          {st.doing > 0 && <span className="chip"><i style={{ color: '#7fb4ff' }} />{st.doing} em órbita</span>}
          {st.overdueCount > 0 && <span className="chip bad"><i />{plural(st.overdueCount, 'atrasada', 'atrasadas')}</span>}
          {st.urgentCount - st.overdueCount > 0 && <span className="chip warn"><i />{plural(st.urgentCount - st.overdueCount, 'prazo próximo', 'prazos próximos')}</span>}
          {st.total > 0 && st.done === st.total && <span className="chip good"><i />Tudo concluído</span>}
          {st.total === 0 && <span className="chip">Sem tarefas ainda</span>}
        </div>
        <div className="hc-sub" style={{ marginTop: 9 }}>{arrange ? 'Arraste para reposicionar' : 'Clique para entrar'}</div>
      </>
    )
  } else {
    const t = data.tasks.find((x) => x.id === hover.id)
    if (!t) return null
    const due = describeDue(t, now)
    const subs = t.subtasks.length
    const overdue = due?.startsWith('Atrasada')
    body = (
      <>
        <div className="hc-head">
          <span className="hc-title" style={{ fontSize: 18 }}>{t.title}</span>
        </div>
        <div className="hc-row">
          <span className="chip"><i style={{ color: STATUS_COLOR[t.status] }} />{STATUS_LABEL[t.status]}</span>
          <span className="chip">{PRIORITY_LABEL[t.priority]}</span>
          {due && t.status !== 'done' && <span className={`chip ${overdue ? 'bad' : 'warn'}`}>{due}</span>}
        </div>
        {subs > 0 && <div className="hc-sub" style={{ marginTop: 8 }}>{t.subtasks.filter((s) => s.done).length}/{subs} subtarefas</div>}
      </>
    )
  }

  return (
    <div ref={ref} className="hover-card glass" style={{ visibility: 'hidden' }} role="tooltip">
      {body}
    </div>
  )
}
