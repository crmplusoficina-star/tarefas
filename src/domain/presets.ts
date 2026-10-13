import type { AtmosphereKind, GroupKind, PlanetStyle, SurfaceKind, SurfaceMix } from './types'

export interface SurfaceInfo {
  kind: SurfaceKind
  label: string
  hint: string
  /** CSS gradient used for the tile preview */
  swatch: string
  detailLabel: string
  turbulenceLabel: string
  coverageLabel: string | null
}

export const SURFACES: SurfaceInfo[] = [
  {
    kind: 'rocky',
    label: 'Rochoso',
    hint: 'Crateras, cordilheiras e relevo marcado',
    swatch: 'radial-gradient(circle at 32% 28%, #d8b48a, #8a5a3c 55%, #2c1b14)',
    detailLabel: 'Escala do relevo',
    turbulenceLabel: 'Contraste',
    coverageLabel: 'Profundidade do relevo',
  },
  {
    kind: 'gas',
    label: 'Gasoso',
    hint: 'Faixas atmosféricas e tempestades',
    swatch: 'radial-gradient(circle at 32% 28%, #f2d9ae, #b57a4d 50%, #3b2a3f)',
    detailLabel: 'Escala das nuvens',
    turbulenceLabel: 'Turbulência',
    coverageLabel: 'Quantidade de faixas',
  },
  {
    kind: 'ocean',
    label: 'Oceânico',
    hint: 'Continentes, mares e calotas polares',
    swatch: 'radial-gradient(circle at 32% 28%, #8fd0e4, #1c5f8f 55%, #0a1c36)',
    detailLabel: 'Escala dos continentes',
    turbulenceLabel: 'Recortes da costa',
    coverageLabel: 'Nível dos oceanos',
  },
  {
    kind: 'tech',
    label: 'Tecnológico',
    hint: 'Malha de circuitos e luzes de cidade',
    swatch: 'radial-gradient(circle at 32% 28%, #7d8ea8, #313d52 55%, #0a0f1a)',
    detailLabel: 'Escala da malha',
    turbulenceLabel: 'Irregularidade',
    coverageLabel: 'Densidade de circuitos',
  },
  {
    kind: 'custom',
    label: 'Personalizado',
    hint: 'Misture as características livremente',
    swatch: 'conic-gradient(from 210deg, #c9985f, #4f8fb6, #6a7a95, #d7b98d, #c9985f)',
    detailLabel: 'Escala dos detalhes',
    turbulenceLabel: 'Turbulência',
    coverageLabel: null,
  },
]

export const surfaceInfo = (k: SurfaceKind) => SURFACES.find((s) => s.kind === k) ?? SURFACES[0]!

export const MIX_PRESETS: Record<SurfaceKind, SurfaceMix> = {
  rocky: { rock: 1, gas: 0, ocean: 0, tech: 0 },
  gas: { rock: 0, gas: 1, ocean: 0, tech: 0 },
  ocean: { rock: 0, gas: 0, ocean: 1, tech: 0 },
  tech: { rock: 0.15, gas: 0, ocean: 0, tech: 1 },
  custom: { rock: 0.6, gas: 0.35, ocean: 0.2, tech: 0.25 },
}

export interface AtmosphereInfo {
  kind: AtmosphereKind
  label: string
  hint: string
}

export const ATMOSPHERES: AtmosphereInfo[] = [
  { kind: 'none', label: 'Nenhuma', hint: 'Sem atmosfera visível' },
  { kind: 'haze', label: 'Névoa', hint: 'Brilho difuso e suave' },
  { kind: 'halo', label: 'Halo', hint: 'Aro luminoso nítido' },
  { kind: 'aurora', label: 'Aurora', hint: 'Cortinas de luz nos polos' },
  { kind: 'storm', label: 'Tempestade', hint: 'Sistemas de nuvens turbulentas' },
  { kind: 'clouds', label: 'Nuvens', hint: 'Camada de nuvens leves' },
]

export interface Palette {
  name: string
  primary: string
  secondary: string
  accent: string
  atmosphere: string
}

export const PALETTES: Palette[] = [
  { name: 'Deserto', primary: '#b9855a', secondary: '#6b4129', accent: '#f0c58b', atmosphere: '#f0b27a' },
  { name: 'Oceano', primary: '#1f6f9f', secondary: '#c8b88a', accent: '#e8f4f8', atmosphere: '#7cc4ee' },
  { name: 'Floresta', primary: '#2f6b4a', secondary: '#8a7a4e', accent: '#d8e9c5', atmosphere: '#8fe0b0' },
  { name: 'Gelo', primary: '#9fc4dd', secondary: '#e8f1f7', accent: '#ffffff', atmosphere: '#b9e2ff' },
  { name: 'Magma', primary: '#4a1f1a', secondary: '#c2461f', accent: '#ffb347', atmosphere: '#ff7a45' },
  { name: 'Ametista', primary: '#5b4a8c', secondary: '#c2a0d9', accent: '#f1e1ff', atmosphere: '#b99aff' },
  { name: 'Cobre', primary: '#a8603a', secondary: '#4b7d78', accent: '#ffd9a8', atmosphere: '#e8a070' },
  { name: 'Grafite', primary: '#3f4857', secondary: '#8b97a8', accent: '#9fe3ff', atmosphere: '#8fc7ff' },
  { name: 'Safira', primary: '#1b3f7a', secondary: '#7aa0d8', accent: '#d8e8ff', atmosphere: '#6ea8ff' },
  { name: 'Ouro', primary: '#8c6a2a', secondary: '#e2c27a', accent: '#fff2c9', atmosphere: '#f4d58a' },
  { name: 'Rosa', primary: '#a8506a', secondary: '#f0b6c4', accent: '#fff0f4', atmosphere: '#ff9ab5' },
  { name: 'Jade', primary: '#2a7a72', secondary: '#9fd8c8', accent: '#e4fff6', atmosphere: '#6fe0cf' },
]

export const GLYPHS = [
  '◐', '✦', '☄', '⚑', '✈', '⌂', '☕', '✎', '⚙', '$', '☂', '♜',
  '♫', '✿', '⚖', '⚗', '☀', '☾', '❖', '⌘', '☎', '✉', '★', '⚡',
]

export const GROUP_KINDS: { kind: GroupKind; label: string; hint: string }[] = [
  { kind: 'auto', label: 'Automático', hint: 'Vira estação quando há muitas tarefas em andamento' },
  { kind: 'moon', label: 'Lua', hint: 'Corpo rochoso em órbita' },
  { kind: 'station', label: 'Estação', hint: 'Estrutura espacial com anel giratório' },
  { kind: 'asteroid', label: 'Asteroide', hint: 'Fragmento irregular' },
]

export const GROUP_COLORS = [
  '#d8b48a', '#8fb8d8', '#9fd0b0', '#d89fb0', '#b9a3e0', '#e8c46a', '#7fd0cf', '#e09a78',
]

export function randomSeed(): number {
  return Math.floor(Math.random() * 100000)
}

export function defaultStyle(): PlanetStyle {
  const p = PALETTES[0]!
  return {
    surface: 'rocky',
    colors: { primary: p.primary, secondary: p.secondary, accent: p.accent },
    detail: 0.5,
    turbulence: 0.5,
    coverage: 0.5,
    mix: { ...MIX_PRESETS.rocky },
    atmosphere: { kind: 'haze', color: p.atmosphere, intensity: 0.7 },
    size: 1,
    seed: randomSeed(),
    tilt: 0.3,
  }
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!

export function randomStyle(): PlanetStyle {
  const palette = pick(PALETTES)
  const surface = pick(SURFACES).kind
  return {
    surface,
    colors: { primary: palette.primary, secondary: palette.secondary, accent: palette.accent },
    detail: 0.25 + Math.random() * 0.6,
    turbulence: 0.2 + Math.random() * 0.7,
    coverage: 0.25 + Math.random() * 0.55,
    mix:
      surface === 'custom'
        ? { rock: Math.random(), gas: Math.random(), ocean: Math.random() * 0.6, tech: Math.random() * 0.6 }
        : { ...MIX_PRESETS[surface] },
    atmosphere: {
      kind: pick(ATMOSPHERES.filter((a) => a.kind !== 'none')).kind,
      color: palette.atmosphere,
      intensity: 0.5 + Math.random() * 0.45,
    },
    size: 0.85 + Math.random() * 0.4,
    seed: randomSeed(),
    tilt: (Math.random() - 0.5) * 0.9,
  }
}
