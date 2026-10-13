import { groupsOfPlanet, sortedPlanets, statsOf, tasksOfGroup, tasksOfPlanet } from '../domain/stats'
import { goGroup, goPlanet, openGroupDialog, openLab, openNewTask, requestDeleteGroup, requestDeletePlanet, selectTask, shiftGroup, shiftPlanet } from '../state/commands'
import { clockStore } from '../state/clock'
import { dataStore } from '../state/dataStore'
import { uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { STATUS_COLOR } from '../scene/Satellites'
import { Icon } from './Icon'
import { Modal } from './primitives'

/** A plain, keyboard- and screen-reader-friendly view of the whole universe, with full management. */
export function OutlineView() {
  const open = useStore(uiStore, (s) => s.outlineOpen)
  const data = useStore(dataStore, (s) => s.data)
  const now = useStore(clockStore, (s) => s.now)
  if (!open) return null
  const close = () => uiStore.set({ outlineOpen: false })
  const planets = sortedPlanets(data.planets)
  return (
    <Modal
      title="Mapa em lista"
      wide
      onClose={close}
      footer={
        <>
          <span className="grow" />
          <button className="btn ghost" onClick={() => (close(), openNewTask())} disabled={planets.length === 0}><Icon name="plus" /> Nova tarefa</button>
          <button className="btn primary" onClick={() => (close(), openLab())}><Icon name="planet" /> Novo planeta</button>
        </>
      }
    >
      {planets.length === 0 && <div className="empty-note">O universo está vazio. Forme o primeiro planeta.</div>}
      <div className="rows" role="tree" aria-label="Universo">
        {planets.map((p, pi) => {
          const st = statsOf(tasksOfPlanet(data.tasks, p.id), now)
          const groups = groupsOfPlanet(data.groups, p.id)
          return (
            <div key={p.id} style={{ display: 'contents' }}>
              <div className="row-item" role="treeitem" aria-expanded="true">
                <span className="glyph-dot" style={{ background: `radial-gradient(circle at 30% 30%, ${p.style.colors.secondary}, ${p.style.colors.primary})` }}>{p.symbol}</span>
                <button className="name" onClick={() => (close(), goPlanet(p.id))}>{p.name}</button>
                <span className="count">{st.done}/{st.total}</span>
                <button className="mini-btn" aria-label={`Mover ${p.name} para cima`} disabled={pi === 0} onClick={() => shiftPlanet(p.id, -1)}><Icon name="up" /></button>
                <button className="mini-btn" aria-label={`Mover ${p.name} para baixo`} disabled={pi === planets.length - 1} onClick={() => shiftPlanet(p.id, 1)}><Icon name="down" /></button>
                <button className="mini-btn" aria-label={`Adicionar grupo em ${p.name}`} onClick={() => (close(), openGroupDialog({ mode: 'new', planetId: p.id }))}><Icon name="plus" /></button>
                <button className="mini-btn" aria-label={`Editar ${p.name}`} onClick={() => (close(), openLab(p.id))}><Icon name="edit" /></button>
                <button className="mini-btn danger" aria-label={`Excluir ${p.name}`} onClick={() => requestDeletePlanet(p.id)}><Icon name="trash" /></button>
              </div>
              {groups.map((g, gi) => {
                const tasks = tasksOfGroup(data.tasks, g.id)
                return (
                  <div key={g.id} style={{ display: 'contents' }}>
                    <div className="row-item tree-indent-1" role="treeitem">
                      <span className="glyph-dot" style={{ background: g.color, width: 16, height: 16, fontSize: 9 }}>{g.symbol}</span>
                      <button className="name" onClick={() => (close(), goGroup(g.id))}>{g.name}</button>
                      <span className="count">{tasks.filter((t) => t.status === 'done').length}/{tasks.length}</span>
                      <button className="mini-btn" aria-label={`Mover ${g.name} para dentro`} disabled={gi === 0} onClick={() => shiftGroup(g.id, -1)}><Icon name="up" /></button>
                      <button className="mini-btn" aria-label={`Mover ${g.name} para fora`} disabled={gi === groups.length - 1} onClick={() => shiftGroup(g.id, 1)}><Icon name="down" /></button>
                      <button className="mini-btn" aria-label={`Nova tarefa em ${g.name}`} onClick={() => (close(), openNewTask({ groupId: g.id }))}><Icon name="plus" /></button>
                      <button className="mini-btn" aria-label={`Editar ${g.name}`} onClick={() => (close(), openGroupDialog({ mode: 'edit', id: g.id }))}><Icon name="edit" /></button>
                      <button className="mini-btn danger" aria-label={`Excluir ${g.name}`} onClick={() => requestDeleteGroup(g.id)}><Icon name="trash" /></button>
                    </div>
                    {tasks.map((t) => (
                      <div key={t.id} className="row-item task-row tree-indent-2" role="treeitem">
                        <span className="pip" style={{ background: STATUS_COLOR[t.status] }} />
                        <button className={`name ${t.status === 'done' ? 'done' : ''}`} onClick={() => (close(), selectTask(t.id))}>{t.title}</button>
                        <span className="count">{t.dueDate ?? ''}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
