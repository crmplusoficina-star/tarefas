import { useEffect, useRef } from 'react'
import { SURFACES, ATMOSPHERES, PALETTES, GLYPHS, MIX_PRESETS, surfaceInfo, randomStyle, randomSeed } from '../domain/presets'
import type { AtmosphereKind, PlanetStyle, SurfaceKind } from '../domain/types'
import { cancelLab, confirmLab, patchLab, requestDeletePlanet } from '../state/commands'
import { dataStore } from '../state/dataStore'
import { uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { runtime } from '../scene/runtime'
import { Icon } from './Icon'
import { OrbitPicker } from './OrbitPicker'
import { Slider } from './primitives'

/** The formation laboratory: design a planet while watching it take shape in the scene. */
export function PlanetLab() {
  const lab = useStore(uiStore, (s) => s.lab)
  const planets = useStore(dataStore, (s) => s.data.planets)
  const nameRef = useRef<HTMLInputElement>(null)
  const open = lab !== null

  useEffect(() => {
    runtime.panelLeft = open ? 440 : 0
    if (open) setTimeout(() => nameRef.current?.focus(), 350)
    return () => {
      runtime.panelLeft = 0
    }
  }, [open])

  if (!lab) return null
  const { draft, editingId } = lab
  const style = draft.style
  const info = surfaceInfo(style.surface)
  const setStyle = (patch: Partial<PlanetStyle>) => patchLab({ style: { ...style, ...patch } })
  const setSurface = (surface: SurfaceKind) =>
    setStyle({ surface, mix: surface === 'custom' ? (style.surface === 'custom' ? style.mix : { ...MIX_PRESETS.custom }) : { ...MIX_PRESETS[surface] } })
  const setAtm = (patch: Partial<PlanetStyle['atmosphere']>) => setStyle({ atmosphere: { ...style.atmosphere, ...patch } })
  const setColor = (k: 'primary' | 'secondary' | 'accent', v: string) => setStyle({ colors: { ...style.colors, [k]: v } })
  const manual = draft.placement !== null
  const existing = editingId ? planets.find((p) => p.id === editingId) : undefined

  return (
    <aside className="panel left glass" role="dialog" aria-label="Laboratório de formação planetária" data-testid="planet-lab">
      <div className="panel-head">
        <div className="grow">
          <div className="mono">{editingId ? 'Editar planeta' : 'Laboratório de formação'}</div>
          <h2 className="panel-title">{draft.name.trim() || (editingId ? 'Planeta' : 'Um novo mundo')}</h2>
        </div>
        <button className="mini-btn" onClick={() => patchLab({ style: randomStyle() })} aria-label="Sortear aparência" title="Sortear aparência">
          <Icon name="dice" />
        </button>
        <button className="mini-btn" onClick={cancelLab} aria-label="Cancelar">
          <Icon name="close" />
        </button>
      </div>

      <form
        className="panel-body"
        onSubmit={(e) => {
          e.preventDefault()
          confirmLab()
        }}
      >
        <div className="section-title">Identidade</div>
        <div className="field">
          <label htmlFor="lab-name">Nome do planeta</label>
          <input id="lab-name" ref={nameRef} className="input big" value={draft.name} maxLength={60} placeholder="Ex.: SEP, Clientes, Viagens…" onChange={(e) => patchLab({ name: e.target.value })} data-testid="lab-name" />
        </div>
        <div className="field">
          <label htmlFor="lab-desc">Descrição</label>
          <textarea id="lab-desc" className="textarea" value={draft.description} placeholder="Para que serve esta categoria?" onChange={(e) => patchLab({ description: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="lab-sym">Símbolo</label>
          <input id="lab-sym" className="input" value={draft.symbol} maxLength={2} aria-describedby="sym-help" onChange={(e) => patchLab({ symbol: e.target.value })} style={{ width: 90, textAlign: 'center', fontSize: 18 }} />
          <div className="glyph-grid" role="group" aria-label="Símbolos sugeridos">
            {GLYPHS.map((g) => (
              <button key={g} type="button" className="glyph" aria-pressed={draft.symbol === g} onClick={() => patchLab({ symbol: g })} aria-label={`Símbolo ${g}`}>
                {g}
              </button>
            ))}
          </div>
          <p className="hint" id="sym-help">Escolha um símbolo ou digite qualquer caractere/emoji.</p>
        </div>

        <div className="section-title">Superfície</div>
        <div className="field">
          <div className="surface-grid" role="group" aria-label="Tipo de superfície">
            {SURFACES.map((s) => (
              <button key={s.kind} type="button" className="surface-tile" aria-pressed={style.surface === s.kind} onClick={() => setSurface(s.kind)} title={s.hint}>
                <i style={{ background: s.swatch }} />
                {s.label}
              </button>
            ))}
          </div>
          <p className="hint">{info.hint}</p>
        </div>
        <Slider label={info.detailLabel} value={style.detail} onChange={(v) => setStyle({ detail: v })} />
        <Slider label={info.turbulenceLabel} value={style.turbulence} onChange={(v) => setStyle({ turbulence: v })} />
        {info.coverageLabel && <Slider label={info.coverageLabel} value={style.coverage} onChange={(v) => setStyle({ coverage: v })} />}
        {style.surface === 'custom' && (
          <div style={{ marginTop: 6 }}>
            <div className="label">Mistura de características</div>
            <Slider label="Rochoso" value={style.mix.rock} onChange={(v) => setStyle({ mix: { ...style.mix, rock: v } })} />
            <Slider label="Gasoso" value={style.mix.gas} onChange={(v) => setStyle({ mix: { ...style.mix, gas: v } })} />
            <Slider label="Oceânico" value={style.mix.ocean} onChange={(v) => setStyle({ mix: { ...style.mix, ocean: v } })} />
            <Slider label="Tecnológico" value={style.mix.tech} onChange={(v) => setStyle({ mix: { ...style.mix, tech: v } })} />
          </div>
        )}
        <div className="row2" style={{ marginTop: 6 }}>
          <button type="button" className="btn ghost" onClick={() => setStyle({ seed: randomSeed() })}>
            <Icon name="sparkle" /> Novo relevo
          </button>
          <Slider label="Tamanho" value={style.size} min={0.7} max={1.4} step={0.01} onChange={(v) => setStyle({ size: v })} format={(v) => `${v.toFixed(2)}×`} />
        </div>

        <div className="section-title">Cores</div>
        <div className="palette-grid" role="group" aria-label="Paletas">
          {PALETTES.map((p) => {
            const active = p.primary === style.colors.primary && p.secondary === style.colors.secondary
            return (
              <button
                key={p.name}
                type="button"
                className="palette-btn"
                aria-pressed={active}
                aria-label={`Paleta ${p.name}`}
                title={p.name}
                style={{ background: `linear-gradient(120deg, ${p.primary} 0 45%, ${p.secondary} 45% 80%, ${p.accent} 80%)` }}
                onClick={() => setStyle({ colors: { primary: p.primary, secondary: p.secondary, accent: p.accent }, atmosphere: { ...style.atmosphere, color: p.atmosphere } })}
              />
            )
          })}
        </div>
        <div className="color-row">
          <label className="color-pick">
            Primária
            <input type="color" value={style.colors.primary} onChange={(e) => setColor('primary', e.target.value)} />
          </label>
          <label className="color-pick">
            Secundária
            <input type="color" value={style.colors.secondary} onChange={(e) => setColor('secondary', e.target.value)} />
          </label>
          <label className="color-pick">
            Realce
            <input type="color" value={style.colors.accent} onChange={(e) => setColor('accent', e.target.value)} />
          </label>
        </div>

        <div className="section-title">Atmosfera</div>
        <div className="atm-grid" role="group" aria-label="Efeito atmosférico">
          {ATMOSPHERES.map((a) => (
            <button key={a.kind} type="button" aria-pressed={style.atmosphere.kind === a.kind} onClick={() => setAtm({ kind: a.kind as AtmosphereKind })} title={a.hint}>
              {a.label}
            </button>
          ))}
        </div>
        {style.atmosphere.kind !== 'none' && (
          <div style={{ marginTop: 14 }}>
            <div className="row2">
              <label className="color-pick">
                Cor do efeito
                <input type="color" value={style.atmosphere.color} onChange={(e) => setAtm({ color: e.target.value })} />
              </label>
              <Slider label="Intensidade" value={style.atmosphere.intensity} onChange={(v) => setAtm({ intensity: v })} />
            </div>
          </div>
        )}

        <div className="section-title">Posição no universo</div>
        <div className="orbit-picker">
          <OrbitPicker
            planets={planets}
            ignoreId={editingId}
            value={manual ? draft.placement : existing ? { lane: existing.lane, phase: existing.phase } : null}
            color={style.colors.primary}
            onChange={(v) => patchLab({ placement: v })}
          />
          <div className="switch">
            <label className="switch-row">
              <input type="checkbox" checked={!manual} onChange={(e) => patchLab({ placement: e.target.checked ? null : existing ? { lane: existing.lane, phase: existing.phase } : { lane: 0, phase: 0 } })} />
              {editingId ? 'Manter posição atual' : 'Posicionar automaticamente'}
            </label>
            <p className="hint" style={{ margin: 0 }}>
              {manual ? 'Clique ou arraste no mapa. Se o lugar estiver ocupado, o planeta é ajustado para a vaga mais próxima.' : 'O universo encontra a vaga livre mais próxima do centro.'}
            </p>
          </div>
        </div>
      </form>

      <div className="panel-foot">
        {editingId && (
          <button type="button" className="btn danger" onClick={() => requestDeletePlanet(editingId)}>
            <Icon name="trash" /> Excluir
          </button>
        )}
        <span className="grow" />
        <button type="button" className="btn ghost" onClick={cancelLab}>
          Cancelar
        </button>
        <button type="button" className="btn primary" onClick={() => confirmLab()} data-testid="lab-confirm">
          <Icon name={editingId ? 'check' : 'sparkle'} /> {editingId ? 'Salvar alterações' : 'Formar planeta'}
        </button>
      </div>
    </aside>
  )
}
