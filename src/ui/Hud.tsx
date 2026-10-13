import { sortedPlanets, groupsOfPlanet } from '../domain/stats'
import { cameraControl } from '../scene/cameraControl'
import {
  autoArrangePlanets,
  goBack,
  goGroup,
  goPlanet,
  goUniverse,
  openGroupDialog,
  openLab,
  openNewTask,
  recenter,
  deselectTask,
  runUndo,
  setTaskStatus,
} from '../state/commands'
import { dataStore } from '../state/dataStore'
import { levelOf, uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { Icon } from './Icon'
import { Radar } from './Radar'

function Crumbs() {
  const data = useStore(dataStore, (s) => s.data)
  const ui = useStore(uiStore, (s) => ({ planetId: s.planetId, groupId: s.groupId, taskId: s.taskId, lab: s.lab }))
  const level = levelOf(ui)
  const planet = data.planets.find((p) => p.id === ui.planetId)
  const group = data.groups.find((g) => g.id === ui.groupId)
  const task = data.tasks.find((t) => t.id === ui.taskId)
  if (ui.lab) {
    return (
      <nav className="crumbs" aria-label="Localização">
        <button className="crumb" onClick={goBack}>Universo</button>
        <span className="crumb-sep">›</span>
        <span className="crumb" aria-current="true">{ui.lab.editingId ? 'Editando planeta' : 'Laboratório de formação'}</span>
      </nav>
    )
  }
  const items: { label: string; on: () => void; current: boolean }[] = [{ label: 'Universo', on: goUniverse, current: level === 'universe' }]
  if (planet) items.push({ label: `${planet.symbol} ${planet.name}`, on: () => goPlanet(planet.id), current: level === 'planet' })
  if (group) items.push({ label: group.name, on: () => goGroup(group.id), current: level === 'group' })
  if (task) items.push({ label: task.title, on: () => {}, current: true })
  return (
    <nav className="crumbs" aria-label="Localização">
      {items.map((it, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span className="crumb-sep" aria-hidden="true">›</span>}
          <button className="crumb" onClick={it.on} aria-current={it.current} title={it.label}>
            {it.label}
          </button>
        </span>
      ))}
    </nav>
  )
}

function Dock() {
  const planets = useStore(dataStore, (s) => s.data.planets)
  const planetId = useStore(uiStore, (s) => s.planetId)
  const lab = useStore(uiStore, (s) => s.lab !== null)
  if (lab) return null
  const sorted = sortedPlanets(planets)
  return (
    <nav className="dock glass" aria-label="Alternar entre planetas">
      {sorted.map((p, i) => (
        <button
          key={p.id}
          className="dock-item"
          aria-current={planetId === p.id}
          aria-label={`Ir para ${p.name}${i < 9 ? ` (tecla ${i + 1})` : ''}`}
          onClick={() => goPlanet(p.id)}
          style={{ background: `radial-gradient(circle at 32% 28%, ${p.style.colors.secondary}, ${p.style.colors.primary} 62%, #0a0c14)` }}
        >
          <span aria-hidden="true">{p.symbol}</span>
          {i < 9 && <span className="num" aria-hidden="true">{i + 1}</span>}
          <span className="dock-tip">{p.name}</span>
        </button>
      ))}
      <button className="dock-item add" aria-label="Formar novo planeta (N)" onClick={() => openLab()}>
        <Icon name="plus" size={16} />
        <span className="dock-tip">Novo planeta</span>
      </button>
    </nav>
  )
}

function ActionBar() {
  const ui = useStore(uiStore, (s) => ({ planetId: s.planetId, groupId: s.groupId, taskId: s.taskId, mode: s.mode, lab: s.lab !== null, panel: s.taskPanel !== null }))
  const planets = useStore(dataStore, (s) => s.data.planets.length)
  const groups = useStore(dataStore, (s) => s.data.groups)
  const task = useStore(dataStore, (s) => s.data.tasks.find((t) => t.id === ui.taskId))
  const level = levelOf(ui)
  if (ui.lab) return null
  const groupCount = ui.planetId ? groupsOfPlanet(groups, ui.planetId).length : 0
  return (
    <div className={`action-bar glass ${ui.panel ? 'shifted' : ''}`} role="toolbar" aria-label="Ações">
      {level === 'universe' && (
        <>
          <button className="btn primary" onClick={() => openLab()}>
            <Icon name="planet" /> Formar planeta <span className="kbd">N</span>
          </button>
          <button className="btn" onClick={() => openNewTask()} disabled={planets === 0}>
            <Icon name="plus" /> Tarefa <span className="kbd">T</span>
          </button>
          <span className="sep-v" />
          <button className={`btn ${ui.mode === 'arrange' ? 'on' : ''}`} aria-pressed={ui.mode === 'arrange'} onClick={() => uiStore.set({ mode: ui.mode === 'arrange' ? 'explore' : 'arrange' })} disabled={planets === 0}>
            <Icon name="move" /> Reorganizar <span className="kbd">R</span>
          </button>
        </>
      )}
      {level === 'planet' && (
        <>
          <button className="btn primary" onClick={() => openGroupDialog({ mode: 'new', planetId: ui.planetId! })}>
            <Icon name="plus" /> Grupo orbital <span className="kbd">G</span>
          </button>
          <button className="btn" onClick={() => openNewTask({ planetId: ui.planetId! })} disabled={groupCount === 0}>
            <Icon name="plus" /> Tarefa <span className="kbd">T</span>
          </button>
          <span className="sep-v" />
          <button className="btn" onClick={() => uiStore.set({ groupManager: true })} disabled={groupCount === 0}>
            <Icon name="list" /> Órbitas
          </button>
          <button className="btn" onClick={() => openLab(ui.planetId!)}>
            <Icon name="edit" /> Editar planeta <span className="kbd">E</span>
          </button>
          <span className="sep-v" />
          <button className="btn" onClick={goUniverse}>
            <Icon name="back" /> Universo
          </button>
        </>
      )}
      {level === 'group' && (
        <>
          <button className="btn primary" onClick={() => openNewTask({ groupId: ui.groupId! })}>
            <Icon name="plus" /> Lançar tarefa <span className="kbd">T</span>
          </button>
          <button className="btn" onClick={() => openGroupDialog({ mode: 'edit', id: ui.groupId! })}>
            <Icon name="edit" /> Editar grupo <span className="kbd">E</span>
          </button>
          <span className="sep-v" />
          <button className="btn" onClick={() => goPlanet(ui.planetId!)}>
            <Icon name="back" /> Planeta
          </button>
        </>
      )}
      {level === 'task' && (
        <>
          {task && task.status !== 'done' && (
            <button className="btn primary" onClick={() => setTaskStatus(task.id, 'done')}>
              <Icon name="check" /> Concluir
            </button>
          )}
          {task && task.status === 'done' && (
            <button className="btn" onClick={() => setTaskStatus(task.id, 'doing')}>
              <Icon name="undo" /> Reabrir
            </button>
          )}
          <button className="btn" onClick={deselectTask}>
            <Icon name="back" /> Grupo
          </button>
        </>
      )}
    </div>
  )
}

function NavTools() {
  const lab = useStore(uiStore, (s) => s.lab !== null)
  return (
    <div className="nav-tools">
      {!lab && <Radar />}
      <div className="zoom-stack">
        <button className="icon-btn" aria-label="Aproximar (+)" title="Aproximar (+)" onClick={() => cameraControl.zoomBy(0.78)}>
          <Icon name="plus" />
        </button>
        <button className="icon-btn" aria-label="Afastar (−)" title="Afastar (−)" onClick={() => cameraControl.zoomBy(1.28)}>
          <Icon name="minus" />
        </button>
        <button
          className="icon-btn"
          aria-label="Centralizar câmera (C)"
          title="Centralizar câmera (C)"
          onClick={() => {
            cameraControl.reset()
            recenter()
          }}
        >
          <Icon name="locate" />
        </button>
      </div>
    </div>
  )
}

function Hints() {
  const ui = useStore(uiStore, (s) => ({ planetId: s.planetId, groupId: s.groupId, taskId: s.taskId, lab: s.lab !== null, forming: s.forming !== null, panel: s.taskPanel !== null }))
  const data = useStore(dataStore, (s) => s.data)
  const ready = useStore(dataStore, (s) => s.ready)
  if (!ready || ui.lab || ui.forming) return null
  const level = levelOf(ui)
  const shifted = ui.panel ? 'shifted' : ''
  if (level === 'universe' && data.planets.length === 0) {
    return (
      <div className={`hint-card glass ${shifted}`} data-testid="empty-universe">
        <h2>Seu universo está vazio</h2>
        <p>Cada planeta é uma categoria criada por você: trabalho, clientes, viagens, estudos… o que fizer sentido. Forme o primeiro e o universo passa a existir.</p>
        <div className="row">
          <button className="btn primary" onClick={() => openLab()}>
            <Icon name="planet" /> Formar o primeiro planeta
          </button>
          <button className="btn ghost" onClick={() => void import('../state/commands').then((m) => m.loadSampleUniverse())}>
            <Icon name="sparkle" /> Explorar um universo de exemplo
          </button>
        </div>
      </div>
    )
  }
  if (level === 'planet' && ui.planetId) {
    const groups = groupsOfPlanet(data.groups, ui.planetId)
    if (groups.length === 0)
      return (
        <div className={`hint-card glass ${shifted}`} data-testid="empty-planet">
          <h2>Nenhum grupo orbital ainda</h2>
          <p>Grupos são as luas e estações deste planeta — por exemplo, “Auditorias” ou “Relatórios”. Crie o primeiro e depois lance tarefas nele.</p>
          <div className="row">
            <button className="btn primary" onClick={() => openGroupDialog({ mode: 'new', planetId: ui.planetId! })}>
              <Icon name="plus" /> Criar grupo orbital
            </button>
          </div>
        </div>
      )
  }
  if ((level === 'group' || level === 'task') && ui.groupId) {
    const count = data.tasks.filter((t) => t.groupId === ui.groupId).length
    if (count === 0 && !ui.panel)
      return (
        <div className={`hint-card glass ${shifted}`} data-testid="empty-group">
          <h2>Nenhum satélite em órbita</h2>
          <p>Cada tarefa vira um satélite. Quanto mais urgente, mais perto do centro ela orbita.</p>
          <div className="row">
            <button className="btn primary" onClick={() => openNewTask({ groupId: ui.groupId! })}>
              <Icon name="plus" /> Lançar a primeira tarefa
            </button>
          </div>
        </div>
      )
  }
  return null
}

function StatusPill() {
  const storage = useStore(dataStore, (s) => s.storage)
  const saveError = useStore(dataStore, (s) => s.saveError)
  const panel = useStore(uiStore, (s) => s.taskPanel !== null)
  const cls = saveError ? 'bad' : !storage.durable ? 'warn' : ''
  const text = saveError ? 'Falha ao salvar' : !storage.durable ? 'Sem armazenamento local' : 'Salvo neste navegador'
  return (
    <button
      className={`status-pill glass ${cls} ${panel ? 'shifted' : ''}`}
      onClick={() => uiStore.set({ settingsOpen: true })}
      title={saveError ?? storage.error ?? 'Seus dados ficam salvos localmente (IndexedDB) e sobrevivem ao recarregar a página.'}
    >
      <span className="led" />
      {text}
    </button>
  )
}

export function Hud() {
  const universeName = useStore(dataStore, (s) => s.data.settings.universeName)
  const panel = useStore(uiStore, (s) => s.taskPanel !== null)
  const arrange = useStore(uiStore, (s) => s.mode === 'arrange')
  const lab = useStore(uiStore, (s) => s.lab !== null)
  return (
    <div className="hud">
      <header className="title-block">
        <div className="kicker mono">
          <span className="dot" /> ÓRBITA
        </div>
        <button className="universe-name" onClick={() => uiStore.set({ settingsOpen: true })} title="Renomear o universo e ajustar configurações" data-testid="universe-name">
          {universeName}
        </button>
        <Crumbs />
      </header>

      <div className={`top-actions ${panel ? 'shifted' : ''}`}>
        <button className="icon-btn" onClick={() => uiStore.set({ searchOpen: true })} aria-label="Busca global (Ctrl+K)" data-testid="search-btn">
          <Icon name="search" /> <span className="kbd">Ctrl K</span>
        </button>
        <button className="icon-btn" onClick={() => uiStore.set({ outlineOpen: true })} aria-label="Mapa em lista (O)" title="Mapa em lista (O)">
          <Icon name="list" />
        </button>
        <button className="icon-btn" onClick={() => runUndo()} aria-label="Desfazer última exclusão (Ctrl+Z)" title="Desfazer (Ctrl+Z)">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" onClick={() => uiStore.set({ helpOpen: true })} aria-label="Atalhos e ajuda (?)" title="Atalhos (?)">
          <Icon name="help" />
        </button>
        <button className="icon-btn" onClick={() => uiStore.set({ settingsOpen: true })} aria-label="Configurações" data-testid="settings-btn">
          <Icon name="settings" />
        </button>
      </div>

      {arrange && (
        <div className="arrange-banner glass">
          <Icon name="move" size={16} /> Arraste os planetas para reposicioná-los nas órbitas.
          <button className="btn ghost" onClick={() => autoArrangePlanets()}>Redistribuir</button>
          <button className="btn primary" onClick={() => uiStore.set({ mode: 'explore' })}>Concluir</button>
        </div>
      )}

      <Dock />
      <NavTools />
      <ActionBar />
      <Hints />
      {!lab && <StatusPill />}
    </div>
  )
}
