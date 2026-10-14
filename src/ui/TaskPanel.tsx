import { useEffect, useMemo, useState } from 'react'
import { groupsOfPlanet, sortedPlanets } from '../domain/stats'
import { describeDue, formatDateTime, fromDateTimeLocal, toDateInput, toDateTimeLocal, urgencyOf } from '../domain/time'
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, type Note, type Priority, type Status, type Subtask, type Task } from '../domain/types'
import { createTask, deselectTask, relocateTask, requestDeleteTask, toggleTaskLink, updateTask } from '../state/commands'
import { clockStore } from '../state/clock'
import { dataStore } from '../state/dataStore'
import { newNote, newSubtask } from '../state/model'
import { uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { runtime } from '../scene/runtime'
import { STATUS_COLOR } from '../scene/Satellites'
import { AttachmentsSection } from './Attachments'
import { Icon } from './Icon'
import { CommitInput, Seg } from './primitives'

const PRIORITY_COLOR: Record<Priority, string> = { critical: '#ff6f5e', high: '#ffb15c', medium: '#e8c98f', low: '#8e9bb3' }

interface Value {
  title: string
  description: string
  dueDate: string | null
  dueTime: string | null
  priority: Priority
  status: Status
  subtasks: Subtask[]
  notes: Note[]
  links: string[]
  completedAt: number | null
}

const addDays = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return toDateInput(d)
}

export function TaskPanel() {
  const panel = useStore(uiStore, (s) => s.taskPanel)
  const taskId = useStore(uiStore, (s) => s.taskId)
  const task = useStore(dataStore, (s) => s.data.tasks.find((t) => t.id === taskId))
  useEffect(() => {
    runtime.panelRight = panel ? 440 : 0
    return () => {
      runtime.panelRight = 0
    }
  }, [panel])
  if (!panel) return null
  if (panel.mode === 'edit') {
    if (!task) return null
    return <ExistingTask key={task.id} task={task} />
  }
  return <NewTask key={`${panel.planetId}`} planetId={panel.planetId} groupId={panel.groupId} priority={panel.priority} />
}

/* --------------------------------------------------------------- existing */

function ExistingTask({ task }: { task: Task }) {
  const data = useStore(dataStore, (s) => s.data)
  const siblings = data.tasks.filter((t) => t.groupId === task.groupId && t.id !== task.id)
  const group = data.groups.find((g) => g.id === task.groupId)
  return (
    <TaskForm
      heading={group ? `${data.planets.find((p) => p.id === task.planetId)?.name} › ${group.name}` : ''}
      value={task}
      onPatch={(p) => updateTask(task.id, p)}
      planetId={task.planetId}
      groupId={task.groupId}
      onLocate={(groupId) => relocateTask(task.id, groupId)}
      siblings={siblings}
      onToggleLink={(other, on) => toggleTaskLink(task.id, other, on)}
      footer={
        <>
          <button className="btn danger" onClick={() => requestDeleteTask(task.id)} data-testid="task-delete">
            <Icon name="trash" /> Excluir
          </button>
          <span className="grow" />
          {task.status !== 'done' ? (
            <button className="btn primary" onClick={() => updateTask(task.id, { status: 'done' })} data-testid="task-complete">
              <Icon name="check" /> Concluir tarefa
            </button>
          ) : (
            <button className="btn ghost" onClick={() => updateTask(task.id, { status: 'doing' })}>
              <Icon name="undo" /> Reabrir
            </button>
          )}
        </>
      }
      attachmentsOf={task}
      meta={`Criada ${formatDateTime(task.createdAt)} · Atualizada ${formatDateTime(task.updatedAt)}`}
      existing
    />
  )
}

/* -------------------------------------------------------------------- new */

function NewTask({ planetId: p0, groupId: g0, priority }: { planetId: string; groupId: string | null; priority?: Priority }) {
  const data = useStore(dataStore, (s) => s.data)
  const [planetId, setPlanetId] = useState(p0)
  const [groupId, setGroupId] = useState<string | null>(g0)
  const [value, setValue] = useState<Value>({
    title: '',
    description: '',
    dueDate: null,
    dueTime: null,
    priority: priority ?? 'medium',
    status: 'todo',
    subtasks: [],
    notes: [],
    links: [],
    completedAt: null,
  })
  const groups = groupsOfPlanet(data.groups, planetId)
  const effectiveGroup = groupId && groups.some((g) => g.id === groupId) ? groupId : (groups[0]?.id ?? null)
  const siblings = effectiveGroup ? data.tasks.filter((t) => t.groupId === effectiveGroup) : []
  const submit = () => {
    if (!effectiveGroup) return
    createTask({ groupId: effectiveGroup, title: value.title, description: value.description, dueDate: value.dueDate, dueTime: value.dueTime, priority: value.priority, status: value.status, subtasks: value.subtasks, notes: value.notes, links: value.links })
  }
  return (
    <TaskForm
      heading="Lançar nova tarefa"
      value={value}
      onPatch={(p) => setValue((v) => ({ ...v, ...p, ...(p.status && p.status !== v.status ? { completedAt: p.status === 'done' ? Date.now() : null } : {}) }))}
      planetId={planetId}
      groupId={effectiveGroup}
      onPlanet={(id) => {
        setPlanetId(id)
        setGroupId(null)
        setValue((v) => ({ ...v, links: [] }))
      }}
      onLocate={(id) => {
        setGroupId(id)
        setValue((v) => ({ ...v, links: [] }))
      }}
      siblings={siblings}
      onToggleLink={(other, on) => setValue((v) => ({ ...v, links: on ? [...v.links, other] : v.links.filter((l) => l !== other) }))}
      footer={
        <>
          <button className="btn ghost" onClick={() => uiStore.set({ taskPanel: null })}>Cancelar</button>
          <span className="grow" />
          <button className="btn primary" onClick={submit} disabled={!effectiveGroup} data-testid="task-create">
            <Icon name="sparkle" /> Lançar tarefa
          </button>
        </>
      }
      onSubmit={submit}
    />
  )
}

/* ------------------------------------------------------------------- form */

function TaskForm({
  heading,
  value,
  onPatch,
  planetId,
  groupId,
  onPlanet,
  onLocate,
  siblings,
  onToggleLink,
  footer,
  meta,
  existing,
  onSubmit,
  attachmentsOf,
}: {
  heading: string
  value: Value
  onPatch: (p: Partial<Value>) => void
  planetId: string
  groupId: string | null
  onPlanet?: (id: string) => void
  onLocate: (groupId: string) => void
  siblings: Task[]
  onToggleLink: (other: string, on: boolean) => void
  footer: React.ReactNode
  meta?: string
  existing?: boolean
  onSubmit?: () => void
  /** the saved task whose attachments are shown (new tasks have nothing to attach to yet) */
  attachmentsOf?: Task
}) {
  const data = useStore(dataStore, (s) => s.data)
  const now = useStore(clockStore, (s) => s.now)
  const [newSub, setNewSub] = useState('')
  const [newNoteText, setNewNoteText] = useState('')
  const [linkPick, setLinkPick] = useState('')
  const groups = groupsOfPlanet(data.groups, planetId)
  const planets = sortedPlanets(data.planets)
  const urgency = urgencyOf({ ...(value as unknown as Task) }, now)
  const dueText = useMemo(() => (value.dueDate ? describeDue(value as unknown as Task, now) : null), [value, now])
  const linked = value.links.map((id) => data.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t)
  const linkable = siblings.filter((t) => !value.links.includes(t.id))
  const doneSubs = value.subtasks.filter((s) => s.done).length

  const setSubtasks = (subtasks: Subtask[]) => onPatch({ subtasks })

  return (
    <aside
      className="panel right glass"
      role="dialog"
      aria-label={existing ? 'Detalhes da tarefa' : 'Nova tarefa'}
      data-testid="task-panel"
      onKeyDown={(e) => {
        if (onSubmit && (e.ctrlKey || e.metaKey) && e.key === 'Enter') onSubmit()
      }}
    >
      <div className="panel-head">
        <div className="grow">
          <div className="mono">{heading}</div>
        </div>
        <button className="mini-btn" onClick={() => (existing ? deselectTask() : uiStore.set({ taskPanel: null }))} aria-label="Fechar painel">
          <Icon name="close" />
        </button>
      </div>

      <div className="panel-body">
        <div className="field">
          <label htmlFor="t-title">Título</label>
          {existing ? (
            <CommitInput id="t-title" className="input big" value={value.title} maxLength={300} onCommit={(v) => v.trim() && onPatch({ title: v })} aria-label="Título da tarefa" />
          ) : (
            <input id="t-title" className="input big" autoFocus value={value.title} maxLength={300} placeholder="O que precisa ser feito?" onChange={(e) => onPatch({ title: e.target.value })} data-testid="task-title" />
          )}
        </div>

        <div className="field">
          <span className="label">Status</span>
          <Seg
            label="Status"
            value={value.status}
            onChange={(v) => onPatch({ status: v })}
            options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s], color: STATUS_COLOR[s] }))}
          />
        </div>

        <div className="field">
          <span className="label">Prioridade</span>
          <Seg
            label="Prioridade"
            value={value.priority}
            onChange={(v) => onPatch({ priority: v })}
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], color: PRIORITY_COLOR[p] }))}
          />
          <p className="hint">Prioridades mais altas orbitam mais perto do centro.</p>
        </div>

        <div className="field">
          <span className="label">Prazo</span>
          <div className="row2">
            <input className="input" type="date" aria-label="Data do prazo" value={value.dueDate ?? ''} onChange={(e) => onPatch({ dueDate: e.target.value || null, dueTime: e.target.value ? value.dueTime : null })} data-testid="task-due-date" />
            <input className="input" type="time" aria-label="Horário do prazo" value={value.dueTime ?? ''} disabled={!value.dueDate} onChange={(e) => onPatch({ dueTime: e.target.value || null })} data-testid="task-due-time" />
          </div>
          <div className="due-quick">
            <button type="button" onClick={() => onPatch({ dueDate: addDays(0) })}>Hoje</button>
            <button type="button" onClick={() => onPatch({ dueDate: addDays(1) })}>Amanhã</button>
            <button type="button" onClick={() => onPatch({ dueDate: addDays(7) })}>Em 7 dias</button>
            {value.dueDate && <button type="button" onClick={() => onPatch({ dueDate: null, dueTime: null })}>Remover prazo</button>}
          </div>
          {dueText && value.status !== 'done' && <div className={`due-state ${urgency === 3 ? 'bad' : urgency > 0 ? 'warn' : ''}`}>{dueText}</div>}
        </div>

        {value.status === 'done' && (
          <div className="field">
            <label htmlFor="t-completed">Data de conclusão</label>
            <input id="t-completed" className="input" type="datetime-local" value={toDateTimeLocal(value.completedAt)} onChange={(e) => onPatch({ completedAt: fromDateTimeLocal(e.target.value) })} data-testid="task-completed-at" />
          </div>
        )}

        <div className="field">
          <label htmlFor="t-desc">Descrição</label>
          {existing ? (
            <CommitInput id="t-desc" multiline className="input" value={value.description} onCommit={(v) => onPatch({ description: v })} placeholder="Detalhes, contexto, critérios de aceite…" aria-label="Descrição" />
          ) : (
            <textarea id="t-desc" className="textarea" value={value.description} placeholder="Detalhes, contexto, critérios de aceite…" onChange={(e) => onPatch({ description: e.target.value })} />
          )}
        </div>

        <div className="field">
          <span className="label">Subtarefas {value.subtasks.length > 0 && `· ${doneSubs}/${value.subtasks.length}`}</span>
          <ul className="sub-list">
            {value.subtasks.map((s) => (
              <li className="sub-item" key={s.id}>
                <input type="checkbox" checked={s.done} aria-label={`Concluir subtarefa ${s.title}`} onChange={(e) => setSubtasks(value.subtasks.map((x) => (x.id === s.id ? { ...x, done: e.target.checked } : x)))} />
                <CommitInput className={`t ${s.done ? 'done' : ''}`} value={s.title} aria-label="Título da subtarefa" onCommit={(v) => (v.trim() ? setSubtasks(value.subtasks.map((x) => (x.id === s.id ? { ...x, title: v.trim() } : x))) : setSubtasks(value.subtasks.filter((x) => x.id !== s.id)))} />
                <button className="mini-btn danger" aria-label="Remover subtarefa" onClick={() => setSubtasks(value.subtasks.filter((x) => x.id !== s.id))}>
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="add-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (!newSub.trim()) return
              setSubtasks([...value.subtasks, newSubtask(newSub)])
              setNewSub('')
            }}
          >
            <input className="input" value={newSub} placeholder="Adicionar subtarefa…" aria-label="Nova subtarefa" onChange={(e) => setNewSub(e.target.value)} data-testid="subtask-input" />
            <button className="btn ghost" type="submit" aria-label="Adicionar subtarefa">
              <Icon name="plus" />
            </button>
          </form>
        </div>

        <div className="field">
          <span className="label">Observações</span>
          <ul className="note-list">
            {[...value.notes].reverse().map((n) => (
              <li className="note-item" key={n.id}>
                <p>{n.text}</p>
                <time>{formatDateTime(n.createdAt)}</time>
                <button className="mini-btn danger" aria-label="Remover observação" onClick={() => onPatch({ notes: value.notes.filter((x) => x.id !== n.id) })}>
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
          <textarea className="textarea" style={{ minHeight: 56 }} value={newNoteText} placeholder="Registrar uma observação…" aria-label="Nova observação" onChange={(e) => setNewNoteText(e.target.value)} data-testid="note-input" />
          <button
            className="btn ghost"
            style={{ marginTop: 8 }}
            disabled={!newNoteText.trim()}
            onClick={() => {
              onPatch({ notes: [...value.notes, newNote(newNoteText)] })
              setNewNoteText('')
            }}
          >
            <Icon name="note" /> Adicionar observação
          </button>
        </div>

        {attachmentsOf ? (
          <AttachmentsSection task={data.tasks.find((t) => t.id === attachmentsOf.id) ?? attachmentsOf} />
        ) : (
          <div className="field">
            <span className="label">Anexos</span>
            <p className="hint">Lance a tarefa primeiro; depois será possível anexar PDFs, imagens, documentos e planilhas.</p>
          </div>
        )}

        <div className="field">
          <span className="label">Conexões</span>
          {linked.length > 0 && (
            <div className="link-chips">
              {linked.map((t) => (
                <span className="link-chip" key={t.id}>
                  <Icon name="link" size={12} />
                  <span title={t.title}>{t.title}</span>
                  <button className="mini-btn" style={{ width: 20, height: 20 }} aria-label={`Remover conexão com ${t.title}`} onClick={() => onToggleLink(t.id, false)}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {linkable.length > 0 ? (
            <select className="select" value={linkPick} aria-label="Conectar a outra tarefa do grupo" onChange={(e) => (onToggleLink(e.target.value, true), setLinkPick(''))}>
              <option value="">Conectar a outra tarefa do grupo…</option>
              {linkable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          ) : (
            linked.length === 0 && <p className="hint">Quando houver outras tarefas neste grupo, você poderá ligá-las por feixes de luz.</p>
          )}
        </div>

        <div className="field">
          <span className="label">Localização</span>
          <div className="row2">
            <select
              className="select"
              aria-label="Planeta"
              value={planetId}
              onChange={(e) => {
                if (onPlanet) onPlanet(e.target.value)
                else {
                  const first = groupsOfPlanet(data.groups, e.target.value)[0]
                  if (first) onLocate(first.id)
                }
              }}
              disabled={!onPlanet && groupsOfPlanetCount(data.groups, data.planets) <= 1}
            >
              {planets.map((p) => (
                <option key={p.id} value={p.id} disabled={!onPlanet && groupsOfPlanet(data.groups, p.id).length === 0}>
                  {p.symbol} {p.name}
                </option>
              ))}
            </select>
            <select className="select" aria-label="Grupo orbital" value={groupId ?? ''} onChange={(e) => e.target.value && onLocate(e.target.value)} data-testid="task-group">
              {groups.length === 0 && <option value="">Sem grupos</option>}
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          {!existing && groups.length === 0 && <p className="hint">Este planeta ainda não tem grupos orbitais. Crie um antes de lançar tarefas.</p>}
          {existing && <p className="hint">Alterar o grupo move a tarefa; conexões com tarefas do grupo antigo são desfeitas.</p>}
        </div>

        {meta && <div className="meta">{meta}</div>}
      </div>

      <div className="panel-foot">{footer}</div>
    </aside>
  )
}

function groupsOfPlanetCount(groups: { planetId: string }[], planets: { id: string }[]) {
  return planets.filter((p) => groups.some((g) => g.planetId === p.id)).length
}
