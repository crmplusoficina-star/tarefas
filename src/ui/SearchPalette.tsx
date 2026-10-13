import { useEffect, useMemo, useRef, useState } from 'react'
import { search, type SearchHit } from '../domain/search'
import { cameraControl } from '../scene/cameraControl'
import { goGroup, goPlanet, goUniverse, loadSampleUniverse, openLab, openNewTask, recenter, selectTask } from '../state/commands'
import { dataStore } from '../state/dataStore'
import { uiStore } from '../state/uiStore'
import { useStore } from '../state/store'

interface Action {
  id: string
  title: string
  hint: string
  run: () => void
  keywords: string
}

export function SearchPalette() {
  const open = useStore(uiStore, (s) => s.searchOpen)
  if (!open) return null
  return <Palette />
}

function Palette() {
  const data = useStore(dataStore, (s) => s.data)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const close = () => uiStore.set({ searchOpen: false })

  const actions = useMemo<Action[]>(
    () => [
      { id: 'a-planet', title: 'Formar novo planeta', hint: 'N', run: () => openLab(), keywords: 'novo criar planeta categoria laboratorio' },
      { id: 'a-task', title: 'Lançar nova tarefa', hint: 'T', run: () => openNewTask(), keywords: 'nova criar tarefa satelite' },
      { id: 'a-universe', title: 'Voltar ao universo', hint: 'Esc', run: () => goUniverse(), keywords: 'universo mapa inicio voltar' },
      { id: 'a-center', title: 'Centralizar câmera', hint: 'C', run: () => (cameraControl.reset(), recenter()), keywords: 'centralizar camera reset zoom' },
      { id: 'a-settings', title: 'Abrir configurações', hint: '', run: () => uiStore.set({ settingsOpen: true }), keywords: 'configuracoes ajustes efeitos backup exportar importar' },
      { id: 'a-outline', title: 'Abrir mapa em lista', hint: 'O', run: () => uiStore.set({ outlineOpen: true }), keywords: 'lista outline acessivel arvore' },
      { id: 'a-help', title: 'Atalhos de teclado', hint: '?', run: () => uiStore.set({ helpOpen: true }), keywords: 'ajuda atalhos teclado' },
      { id: 'a-sample', title: 'Carregar universo de exemplo', hint: '', run: () => loadSampleUniverse(), keywords: 'exemplo demo demonstracao' },
    ],
    [],
  )

  const q = query.trim()
  const hits = useMemo(() => search(data, q), [data, q])
  const matchedActions = useMemo(() => {
    if (!q) return actions.slice(0, 5)
    const t = q.toLowerCase()
    return actions.filter((a) => `${a.title} ${a.keywords}`.toLowerCase().includes(t))
  }, [actions, q])

  const rows: ({ type: 'hit'; hit: SearchHit } | { type: 'action'; action: Action })[] = useMemo(
    () => [...hits.map((hit) => ({ type: 'hit' as const, hit })), ...matchedActions.map((action) => ({ type: 'action' as const, action }))],
    [hits, matchedActions],
  )

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const choose = (i: number) => {
    const row = rows[i]
    if (!row) return
    close()
    if (row.type === 'action') return row.action.run()
    const { kind, id } = row.hit
    if (kind === 'planet') goPlanet(id)
    else if (kind === 'group') goGroup(id)
    else selectTask(id)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(rows.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(index)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
  }

  let lastGroup = ''
  return (
    <div className="modal-back" style={{ placeItems: 'start center' }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette glass" role="dialog" aria-modal="true" aria-label="Busca global" onKeyDown={onKey}>
        <input
          ref={input}
          autoFocus
          value={query}
          placeholder="Buscar planetas, grupos, tarefas ou ações…"
          onChange={(e) => (setQuery(e.target.value), setIndex(0))}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={`pal-${index}`}
          data-testid="search-input"
        />
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {rows.length === 0 && <div className="palette-empty">Nada encontrado para “{q}”.</div>}
          {rows.map((row, i) => {
            const group = row.type === 'action' ? 'Ações' : row.hit.kind === 'planet' ? 'Planetas' : row.hit.kind === 'group' ? 'Grupos orbitais' : 'Tarefas'
            const header = group !== lastGroup ? <div className="palette-group" key={`h-${group}`}>{group}</div> : null
            lastGroup = group
            return (
              <div key={`${row.type}-${i}`} style={{ display: 'contents' }}>
                {header}
                <button id={`pal-${i}`} role="option" aria-selected={i === index} className="palette-item" onMouseMove={() => setIndex(i)} onClick={() => choose(i)} data-testid="search-result">
                  {row.type === 'hit' ? (
                    <>
                      <span className="ic" style={{ background: row.hit.color }}>{row.hit.symbol}</span>
                      <span className="tx"><b>{row.hit.title}</b><small>{row.hit.subtitle}</small></span>
                    </>
                  ) : (
                    <>
                      <span className="ic" style={{ background: 'transparent' }}>›</span>
                      <span className="tx"><b>{row.action.title}</b></span>
                      {row.action.hint && <span className="kbd">{row.action.hint}</span>}
                    </>
                  )}
                </button>
              </div>
            )
          })}
        </div>
        <div className="palette-foot">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> navegar</span>
          <span><span className="kbd">Enter</span> abrir</span>
          <span><span className="kbd">Esc</span> fechar</span>
        </div>
      </div>
    </div>
  )
}
