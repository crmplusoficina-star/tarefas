import { useState } from 'react'
import { GROUP_COLORS, GROUP_KINDS } from '../domain/presets'
import { groupsOfPlanet, statsOf, tasksOfGroup } from '../domain/stats'
import type { Group, GroupKind } from '../domain/types'
import { goGroup, requestDeleteGroup, saveGroup, shiftGroup } from '../state/commands'
import { clockStore } from '../state/clock'
import { dataStore } from '../state/dataStore'
import { uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { Icon } from './Icon'
import { Modal } from './primitives'

const randomGroupColor = () => GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)]!

export function GroupDialog() {
  const dialog = useStore(uiStore, (s) => s.groupDialog)
  const groups = useStore(dataStore, (s) => s.data.groups)
  if (!dialog) return null
  const existing = dialog.mode === 'edit' ? groups.find((g) => g.id === dialog.id) : undefined
  if (dialog.mode === 'edit' && !existing) return null
  return <GroupForm key={dialog.mode === 'edit' ? dialog.id : 'new'} dialog={dialog} existing={existing} />
}

function GroupForm({ dialog, existing }: { dialog: NonNullable<ReturnType<typeof uiStore.get>['groupDialog']>; existing?: Group }) {
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [symbol, setSymbol] = useState(existing?.symbol ?? '')
  const [color, setColor] = useState(() => existing?.color ?? randomGroupColor())
  const [kind, setKind] = useState<GroupKind>(existing?.kind ?? 'auto')
  const close = () => uiStore.set({ groupDialog: null })
  const submit = () => {
    const id = saveGroup(dialog, { name, description, symbol, color, kind })
    if (id && dialog.mode === 'new') goGroup(id)
  }
  const planetId = existing?.planetId ?? (dialog.mode === 'new' ? dialog.planetId : '')
  const siblings = groupsOfPlanet(dataStore.get().data.groups, planetId)
  const idx = existing ? siblings.findIndex((g) => g.id === existing.id) : -1
  return (
    <Modal
      title={existing ? 'Editar grupo orbital' : 'Novo grupo orbital'}
      onClose={close}
      footer={
        <>
          {existing && (
            <button className="btn danger" onClick={() => requestDeleteGroup(existing.id)}>
              <Icon name="trash" /> Excluir
            </button>
          )}
          <span className="grow" />
          <button className="btn ghost" onClick={close}>Cancelar</button>
          <button className="btn primary" onClick={submit} data-testid="group-save">
            <Icon name="check" /> {existing ? 'Salvar' : 'Criar grupo'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="field">
          <label htmlFor="g-name">Nome</label>
          <input id="g-name" className="input big" value={name} maxLength={60} placeholder="Ex.: Auditorias, Relatórios…" onChange={(e) => setName(e.target.value)} data-testid="group-name" />
        </div>
        <div className="field">
          <label htmlFor="g-desc">Descrição (opcional)</label>
          <input id="g-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="g-sym">Símbolo (opcional)</label>
            <input id="g-sym" className="input" value={symbol} maxLength={2} onChange={(e) => setSymbol(e.target.value)} style={{ textAlign: 'center' }} />
          </div>
          <div className="field">
            <span className="label">Cor</span>
            <div className="swatches">
              {GROUP_COLORS.map((c) => (
                <button key={c} type="button" className="swatch" aria-label={`Cor ${c}`} aria-pressed={c === color} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Cor personalizada" style={{ width: 28, height: 28, padding: 0, border: 0, background: 'none' }} />
            </div>
          </div>
        </div>
        <div className="field">
          <span className="label">Forma no espaço</span>
          <div className="kind-list">
            {GROUP_KINDS.map((k) => (
              <button key={k.kind} type="button" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
                <b>{k.label}</b>
                <span>{k.hint}</span>
              </button>
            ))}
          </div>
        </div>
        {existing && siblings.length > 1 && (
          <div className="field">
            <span className="label">Posição orbital</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn ghost" disabled={idx <= 0} onClick={() => shiftGroup(existing.id, -1)}>
                <Icon name="up" /> Mais para dentro
              </button>
              <button type="button" className="btn ghost" disabled={idx >= siblings.length - 1} onClick={() => shiftGroup(existing.id, 1)}>
                <Icon name="down" /> Mais para fora
              </button>
            </div>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

/** Manage every orbit of the current planet in one place: reorder, rename, delete. */
export function GroupManager() {
  const open = useStore(uiStore, (s) => s.groupManager)
  const planetId = useStore(uiStore, (s) => s.planetId)
  const data = useStore(dataStore, (s) => s.data)
  const now = useStore(clockStore, (s) => s.now)
  if (!open || !planetId) return null
  const planet = data.planets.find((p) => p.id === planetId)
  const groups = groupsOfPlanet(data.groups, planetId)
  const close = () => uiStore.set({ groupManager: false })
  return (
    <Modal
      title={`Órbitas de ${planet?.name ?? ''}`}
      onClose={close}
      footer={
        <>
          <span className="grow" />
          <button className="btn primary" onClick={() => uiStore.set({ groupManager: false, groupDialog: { mode: 'new', planetId } })}>
            <Icon name="plus" /> Novo grupo orbital
          </button>
        </>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>A ordem define a órbita: o primeiro grupo fica mais perto do planeta.</p>
      <div className="rows">
        {groups.map((g, i) => {
          const st = statsOf(tasksOfGroup(data.tasks, g.id), now)
          return (
            <div className="row-item" key={g.id}>
              <span className="glyph-dot" style={{ background: g.color }}>{g.symbol || ''}</span>
              <button className="name" onClick={() => goGroup(g.id)}>{g.name}</button>
              <span className="count">{st.done}/{st.total}</span>
              <button className="mini-btn" aria-label={`Mover ${g.name} para dentro`} disabled={i === 0} onClick={() => shiftGroup(g.id, -1)}><Icon name="up" /></button>
              <button className="mini-btn" aria-label={`Mover ${g.name} para fora`} disabled={i === groups.length - 1} onClick={() => shiftGroup(g.id, 1)}><Icon name="down" /></button>
              <button className="mini-btn" aria-label={`Editar ${g.name}`} onClick={() => uiStore.set({ groupManager: false, groupDialog: { mode: 'edit', id: g.id } })}><Icon name="edit" /></button>
              <button className="mini-btn danger" aria-label={`Excluir ${g.name}`} onClick={() => requestDeleteGroup(g.id)}><Icon name="trash" /></button>
            </div>
          )
        })}
        {groups.length === 0 && <div className="empty-note">Este planeta ainda não tem grupos.</div>}
      </div>
    </Modal>
  )
}
