import { useEffect, useRef } from 'react'
import { laneRadius, universeExtent, laneOmega, planetRadius } from '../domain/layout'
import { dataStore } from '../state/dataStore'
import { goPlanet } from '../state/commands'
import { uiStore } from '../state/uiStore'
import { runtime } from '../scene/runtime'

const SIZE = 148

/** A top-down locator: where am I, where is everything else. Click a planet to travel. */
export function Radar() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const hits = useRef<{ id: string; x: number; y: number }[]>([])

  useEffect(() => {
    const c = canvas.current!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = SIZE * dpr
    c.height = SIZE * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    let raf = 0
    let last = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - last < 60) return
      last = t
      const { planets } = dataStore.get().data
      const ui = uiStore.get()
      const ext = universeExtent(planets) + 12
      const cx = SIZE / 2
      const k = (SIZE / 2 - 10) / ext
      ctx.clearRect(0, 0, SIZE, SIZE)
      const bg = ctx.createRadialGradient(cx, cx, 2, cx, cx, SIZE / 2)
      bg.addColorStop(0, 'rgba(60,80,130,0.22)')
      bg.addColorStop(1, 'rgba(8,12,22,0.1)')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, SIZE, SIZE)

      // lanes
      ctx.strokeStyle = 'rgba(160,185,230,0.16)'
      ctx.lineWidth = 1
      const lanes = new Set(planets.map((p) => p.lane))
      lanes.forEach((l) => {
        ctx.beginPath()
        ctx.arc(cx, cx, laneRadius(l) * k, 0, Math.PI * 2)
        ctx.stroke()
      })
      // sun
      ctx.fillStyle = '#f0c27a'
      ctx.shadowColor = '#f0c27a'
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.arc(cx, cx, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0

      // camera view cone (screen up = -z when az = 0 … draw using world x/z)
      const cam = runtime.cam
      const camX = cam.pos.x * k
      const camZ = cam.pos.z * k
      const lim = SIZE / 2 - 4
      const px = cx + Math.max(-lim, Math.min(lim, camX))
      const pz = cx + Math.max(-lim, Math.min(lim, camZ))
      const tx = cx + cam.target.x * k
      const tz = cx + cam.target.z * k
      const ang = Math.atan2(tz - pz, tx - px)
      ctx.fillStyle = 'rgba(232,201,143,0.10)'
      ctx.beginPath()
      ctx.moveTo(px, pz)
      ctx.arc(px, pz, 70, ang - 0.55, ang + 0.55)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(232,201,143,0.9)'
      ctx.beginPath()
      ctx.arc(px, pz, 2, 0, Math.PI * 2)
      ctx.fill()

      // planets
      const list: { id: string; x: number; y: number }[] = []
      for (const p of planets) {
        const pos = runtime.pos.get(`p:${p.id}`)
        const a = p.phase + laneOmega(p.lane) * runtime.tU
        const x = cx + (pos ? pos.x : Math.cos(a) * laneRadius(p.lane)) * k
        const y = cx + (pos ? pos.z : Math.sin(a) * laneRadius(p.lane)) * k
        list.push({ id: p.id, x, y })
        const r = Math.max(2.2, planetRadius(p.style.size) * k * 1.5)
        ctx.fillStyle = p.style.colors.primary
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
        if (ui.planetId === p.id) {
          ctx.strokeStyle = '#e8c98f'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(x, y, r + 3.5, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      hits.current = list
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * SIZE
    const y = ((e.clientY - r.top) / r.height) * SIZE
    let best: { id: string; d: number } | null = null
    for (const h of hits.current) {
      const d = Math.hypot(h.x - x, h.y - y)
      if (d < 12 && (!best || d < best.d)) best = { id: h.id, d }
    }
    if (best) goPlanet(best.id)
  }

  return (
    <div className="radar glass" aria-hidden="true" title="Radar do universo — clique em um planeta para viajar até ele">
      <canvas ref={canvas} onClick={onClick} />
      <div className="radar-cap">radar</div>
    </div>
  )
}
