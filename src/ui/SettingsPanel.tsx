import { useRef } from 'react'
import { autoArrangePlanets, exportBackup, importBackup, loadSampleUniverse, requestResetUniverse, updateSettings } from '../state/commands'
import { dataStore } from '../state/dataStore'
import { pushToast, uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { PROFILES, resolveQuality } from '../scene/quality'
import type { EffectsLevel, MotionPref } from '../domain/types'
import { Icon } from './Icon'
import { CommitInput, Modal, Seg, Slider } from './primitives'

const TIER_LABEL = { low: 'mínimo', medium: 'equilibrado', high: 'cinematográfico' } as const

export function SettingsPanel() {
  const open = useStore(uiStore, (s) => s.settingsOpen)
  if (!open) return null
  return <Settings />
}

function Settings() {
  const data = useStore(dataStore, (s) => s.data)
  const storage = useStore(dataStore, (s) => s.storage)
  const saveError = useStore(dataStore, (s) => s.saveError)
  const autoQuality = useStore(uiStore, (s) => s.autoQuality)
  const file = useRef<HTMLInputElement>(null)
  const s = data.settings
  const close = () => uiStore.set({ settingsOpen: false })
  const tier = resolveQuality(s.effects, autoQuality)

  const doExport = async () => {
    const { filename, text } = await exportBackup()
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    pushToast(`Backup “${filename}” gerado.`, 'success')
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    close()
    try {
      await importBackup(await f.text())
    } catch {
      pushToast('Não foi possível ler o arquivo.', 'error')
    }
    if (file.current) file.current.value = ''
  }

  return (
    <Modal title="Configurações do universo" wide onClose={close} footer={<><span className="grow" /><button className="btn primary" onClick={close}>Concluir</button></>}>
      <div className="section-title">Universo</div>
      <div className="field">
        <label htmlFor="u-name">Nome do universo</label>
        <CommitInput id="u-name" className="input big" value={s.universeName} maxLength={60} onCommit={(v) => updateSettings({ universeName: v })} aria-label="Nome do universo" />
      </div>
      <div className="field">
        <button className="btn ghost" onClick={() => (autoArrangePlanets(), close())} disabled={data.planets.length < 2}>
          <Icon name="orbit" /> Redistribuir planetas automaticamente
        </button>
      </div>

      <div className="section-title">Efeitos gráficos</div>
      <div className="field">
        <Seg<EffectsLevel>
          label="Intensidade dos efeitos"
          value={s.effects}
          onChange={(v) => updateSettings({ effects: v })}
          options={[
            { value: 'auto', label: 'Automático' },
            { value: 'minimal', label: 'Mínimo' },
            { value: 'balanced', label: 'Equilibrado' },
            { value: 'cinematic', label: 'Cinematográfico' },
          ]}
        />
        <p className="hint">
          Em uso: <b>{TIER_LABEL[tier]}</b> (resolução até {PROFILES[tier].maxDpr}×, {Math.round(PROFILES[tier].starScale * 100)}% das estrelas
          {PROFILES[tier].nebula ? ', nebulosa' : ', sem nebulosa'}). No modo automático, o app reduz os efeitos sozinho se a taxa de quadros cair.
        </p>
      </div>
      <div className="field">
        <span className="label">Movimento</span>
        <Seg<MotionPref>
          label="Preferência de movimento"
          value={s.motion}
          onChange={(v) => updateSettings({ motion: v })}
          options={[
            { value: 'system', label: 'Seguir o sistema' },
            { value: 'reduced', label: 'Reduzido' },
            { value: 'full', label: 'Completo' },
          ]}
        />
        <p className="hint">Movimento reduzido para as órbitas, o brilho piscante e as viagens de câmera.</p>
      </div>
      <Slider label="Velocidade das órbitas" value={s.orbitSpeed} min={0} max={2} step={0.05} onChange={(v) => updateSettings({ orbitSpeed: v })} format={(v) => `${v.toFixed(2)}×`} />
      <div className="field" style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <label className="switch-row">
          <input type="checkbox" checked={s.showLabels} onChange={(e) => updateSettings({ showLabels: e.target.checked })} /> Mostrar rótulos
        </label>
        <label className="switch-row">
          <input type="checkbox" checked={s.showOrbits} onChange={(e) => updateSettings({ showOrbits: e.target.checked })} /> Mostrar trilhas orbitais
        </label>
      </div>

      <div className="section-title">Dados e recuperação</div>
      {!storage.durable && (
        <div className="callout">
          O armazenamento local do navegador não está disponível ({storage.error ?? 'motivo desconhecido'}). Suas alterações valem apenas para esta sessão — exporte um backup para não perdê-las.
        </div>
      )}
      {saveError && <div className="callout">Falha ao salvar: {saveError}</div>}
      <div className="stat-line"><span>Armazenamento</span><b>{storage.durable ? 'IndexedDB (neste navegador)' : 'Somente memória'}</b></div>
      <div className="stat-line"><span>Planetas · Grupos · Tarefas</span><b>{data.planets.length} · {data.groups.length} · {data.tasks.length}</b></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        <button className="btn ghost" onClick={doExport} data-testid="export-btn"><Icon name="download" /> Exportar backup</button>
        <button className="btn ghost" onClick={() => file.current?.click()}><Icon name="upload" /> Importar backup</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="import-input" />
        <button className="btn ghost" onClick={() => (close(), loadSampleUniverse())}><Icon name="sparkle" /> Carregar exemplo</button>
        <button className="btn danger" onClick={() => (close(), requestResetUniverse())}><Icon name="trash" /> Apagar tudo</button>
      </div>
      <p className="hint">A camada de dados é isolada por um adaptador de armazenamento, preparada para uma futura sincronização com backend.</p>
    </Modal>
  )
}

export function HelpOverlay() {
  const open = useStore(uiStore, (s) => s.helpOpen)
  if (!open) return null
  const rows: [string, string][] = [
    ['N', 'Formar novo planeta'],
    ['G', 'Novo grupo orbital (no planeta)'],
    ['T', 'Nova tarefa'],
    ['E', 'Editar planeta / grupo atual'],
    ['R', 'Reorganizar planetas (arrastar)'],
    ['Ctrl K  ·  /', 'Busca global'],
    ['O', 'Mapa em lista (acessível)'],
    ['1 – 9', 'Ir direto a um planeta'],
    ['[  ]', 'Planeta anterior / próximo'],
    ['0  ·  Esc', 'Subir um nível / voltar'],
    ['C  ·  Home', 'Centralizar câmera'],
    ['+  −', 'Zoom'],
    ['← ↑ → ↓', 'Panorâmica (Shift = rápido)'],
    ['Ctrl Z', 'Desfazer exclusão'],
    ['Tab', 'Percorrer objetos do mapa'],
    ['?', 'Esta ajuda'],
  ]
  return (
    <Modal title="Atalhos e gestos" wide onClose={() => uiStore.set({ helpOpen: false })}>
      <div className="help-grid">
        {rows.map(([k, d]) => (
          <div className="help-row" key={k}>
            <span>{d}</span>
            <span className="kbd">{k}</span>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 16 }}>
        Mouse: arraste para girar · botão direito (ou Shift) para mover · roda para zoom · clique em um objeto para entrar nele.
      </p>
    </Modal>
  )
}
