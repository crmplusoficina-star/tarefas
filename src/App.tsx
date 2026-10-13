import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { flushPending, reconcileNavigation } from './state/commands'
import { dataStore, initData } from './state/dataStore'
import { startClock } from './state/clock'
import { pushToast, uiStore } from './state/uiStore'
import { useStore } from './state/store'
import { guessInitialQuality, webglAvailable } from './scene/quality'
import { useShortcuts } from './hooks/useShortcuts'
import { Hud } from './ui/Hud'
import { HoverCard } from './ui/HoverCard'
import { WorldLabels } from './ui/WorldLabels'
import { PlanetLab } from './ui/PlanetLab'
import { TaskPanel } from './ui/TaskPanel'
import { GroupDialog, GroupManager } from './ui/GroupDialogs'
import { SearchPalette } from './ui/SearchPalette'
import { HelpOverlay, SettingsPanel } from './ui/SettingsPanel'
import { OutlineView } from './ui/OutlineView'
import { ConfirmDialog, LiveRegion, Toasts } from './ui/Feedback'
import { Icon } from './ui/Icon'

const Scene = lazy(() => import('./scene/Scene').then((m) => ({ default: m.Scene })))

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('Falha ao iniciar a cena 3D', error)
    uiStore.set({ webglFailed: true })
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function Fallback() {
  return (
    <>
      <div className="fallback-sky" />
      <div className="hint-card glass" style={{ bottom: 'auto', top: 130 }} role="alert">
        <h2>Gráficos 3D indisponíveis</h2>
        <p>Seu navegador não conseguiu iniciar o WebGL. Todas as funções continuam disponíveis pelo mapa em lista.</p>
        <div className="row">
          <button className="btn primary" onClick={() => uiStore.set({ outlineOpen: true })}>
            <Icon name="list" /> Abrir mapa em lista
          </button>
        </div>
      </div>
    </>
  )
}

export function App() {
  useShortcuts()
  const ready = useStore(dataStore, (s) => s.ready)
  const webglFailed = useStore(uiStore, (s) => s.webglFailed)
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    uiStore.set({ autoQuality: guessInitialQuality() })
    if (!webglAvailable()) uiStore.set({ webglFailed: true, outlineOpen: true })
    startClock()
    void initData().then((report) => {
      if (report.dropped > 0) pushToast(`${report.dropped} registro(s) corrompido(s) foram ignorados ao abrir seus dados.`, 'warn', undefined, 9000)
      if (dataStore.get().storage.error) pushToast('Armazenamento local indisponível: suas alterações não serão mantidas ao recarregar. Exporte um backup nas Configurações.', 'warn', undefined, 12000)
      setTimeout(() => setBooted(true), 450)
    })
    const flush = () => void flushPending()
    const vis = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', vis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])

  // keep navigation valid whenever data changes underneath it (delete, undo, import…)
  useEffect(() => dataStore.subscribe(() => reconcileNavigation()), [])

  return (
    <div className="app">
      {ready && !webglFailed && (
        <SceneBoundary>
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
        </SceneBoundary>
      )}
      {webglFailed && <Fallback />}
      {ready && (
        <>
          <WorldLabels />
          <HoverCard />
          <Hud />
          <PlanetLab />
          <TaskPanel />
          <GroupDialog />
          <GroupManager />
          <SearchPalette />
          <SettingsPanel />
          <OutlineView />
          <HelpOverlay />
          <ConfirmDialog />
          <Toasts />
          <LiveRegion />
        </>
      )}
      <div className={`boot ${booted ? 'gone' : ''}`} aria-hidden={booted} role="status">
        <div className="boot-core">
          <div className="boot-orb" />
          <div className="mono">Formando o universo…</div>
        </div>
      </div>
    </div>
  )
}
