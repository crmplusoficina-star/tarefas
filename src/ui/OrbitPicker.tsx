import { useRef } from 'react'
import { laneOmega, laneRadius, TAU, wrapAngle } from '../domain/layout'
import type { Planet } from '../domain/types'
import { runtime } from '../scene/runtime'

const S = 188
const C = S / 2

/** A top-down map of the orbital lanes. Click or drag to choose where the planet will live. */
export function OrbitPicker({
  planets,
  ignoreId,
  value,
  onChange,
  color,
}: {
  planets: Planet[]
  ignoreId: string | null
  value: { lane: number; phase: number } | null
  onChange: (v: { lane: number; phase: number }) => void
  color: string
}) {
  const others = planets.filter((p) => p.id !== ignoreId)
  const maxLane = Math.max(1, ...others.map((p) => p.lane), value?.lane ?? 0) + 1
  const rOf = (lane: number) => 24 + (lane / maxLane) * (C - 30)
  const svg = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)

  const pick = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * S - C
    const y = ((e.clientY - r.top) / r.height) * S - C
    const dist = Math.hypot(x, y)
    const lane = Math.max(0, Math.min(maxLane, Math.round(((dist - 24) / (C - 30)) * maxLane)))
    const angleNow = Math.atan2(y, x)
    onChange({ lane, phase: wrapAngle(angleNow - laneOmega(lane) * runtime.tU) })
  }

  const here = value
    ? (() => {
        const a = value.phase + laneOmega(value.lane) * runtime.tU
        return { x: C + Math.cos(a) * rOf(value.lane), y: C + Math.sin(a) * rOf(value.lane) }
      })()
    : null

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${S} ${S}`}
      role="img"
      aria-label="Mapa de órbitas: clique para escolher a posição do planeta"
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        pick(e)
      }}
      onPointerMove={(e) => dragging.current && pick(e)}
      onPointerUp={() => (dragging.current = false)}
    >
      <circle cx={C} cy={C} r={6} fill="#f0c27a" />
      {Array.from({ length: maxLane + 1 }, (_, l) => (
        <circle key={l} cx={C} cy={C} r={rOf(l)} fill="none" stroke={value?.lane === l ? '#e8c98f' : 'rgba(160,185,230,0.2)'} strokeWidth={value?.lane === l ? 1.4 : 1} strokeDasharray={value?.lane === l ? undefined : '2 4'} />
      ))}
      {others.map((p) => {
        const a = p.phase + laneOmega(p.lane) * runtime.tU
        return <circle key={p.id} cx={C + Math.cos(a) * rOf(Math.min(p.lane, maxLane))} cy={C + Math.sin(a) * rOf(Math.min(p.lane, maxLane))} r={4} fill={p.style.colors.primary} opacity={0.75} />
      })}
      {here && (
        <>
          <circle cx={here.x} cy={here.y} r={9} fill="none" stroke="#e8c98f" strokeOpacity={0.5} />
          <circle cx={here.x} cy={here.y} r={6} fill={color} stroke="#fff" strokeWidth={1.5} />
        </>
      )}
    </svg>
  )
}

export { TAU, laneRadius }
