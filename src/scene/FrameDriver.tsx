import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { DirectionalLight, Vector3 } from 'three'
import { dataStore } from '../state/dataStore'
import { levelOf, pushToast, uiStore } from '../state/uiStore'
import { resolveQuality } from './quality'
import { runtime, stepDt } from './runtime'

/** Advances the orbit clocks and watches frame times to degrade gracefully on weak GPUs. */
export function FrameDriver() {
  const perf = useRef({ acc: 0, frames: 0, lowWindows: 0, elapsed: 0 })

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      const pref = dataStore.get().data.settings.motion
      runtime.reducedMotion = pref === 'reduced' || (pref === 'system' && mq.matches)
      document.documentElement.classList.toggle('reduce-motion', runtime.reducedMotion)
    }
    apply()
    mq.addEventListener('change', apply)
    const unsub = dataStore.subscribe(apply)
    return () => {
      mq.removeEventListener('change', apply)
      unsub()
    }
  }, [])

  useFrame((_, dtRaw) => {
    const dt = stepDt(dtRaw)
    const ui = uiStore.get()
    const settings = dataStore.get().data.settings
    const level = levelOf(ui)
    const reduced = runtime.reducedMotion
    if (!reduced) runtime.time += dt

    const speed = reduced ? 0 : settings.orbitSpeed
    const lab = ui.lab !== null
    // orbits ease almost to a halt while the pointer is on a planet, so it is easy to click
    const tU = level === 'universe' && ui.mode !== 'arrange' && !lab && !ui.forming ? (ui.hover ? 0.1 : 1) : 0
    const tP = level === 'planet' && !lab ? 1 : 0
    const tG = level === 'group' && !lab ? 1 : 0
    const k = 1 - Math.exp(-dt * 1.7)
    runtime.fU += (tU - runtime.fU) * k
    runtime.fP += (tP - runtime.fP) * k
    runtime.fG += (tG - runtime.fG) * k
    runtime.tU += dt * runtime.fU * speed
    runtime.tP += dt * runtime.fP * speed
    runtime.tG += dt * runtime.fG * speed

    // frame-time watchdog (only when effects are on "auto")
    const p = perf.current
    p.elapsed += dtRaw
    if (p.elapsed > 4) {
      p.acc += dtRaw
      p.frames++
      if (p.acc >= 2.5) {
        const fps = p.frames / p.acc
        runtime.fps = fps
        p.acc = 0
        p.frames = 0
        if (settings.effects === 'auto' && ui.autoQuality !== 'low') {
          p.lowWindows = fps < 38 ? p.lowWindows + 1 : 0
          if (p.lowWindows >= 2) {
            p.lowWindows = 0
            const next = ui.autoQuality === 'high' ? 'medium' : 'low'
            uiStore.set({ autoQuality: next })
            pushToast(`Reduzimos os efeitos gráficos (${next === 'low' ? 'mínimo' : 'equilibrado'}) para manter a fluidez. Ajuste em Configurações.`, 'info', undefined, 8000)
          }
        }
      }
    }
  })
  return null
}

/** A sun-aligned directional light that follows whatever the camera is looking at. */
export function SunLight() {
  const light = useRef<DirectionalLight | null>(null)
  if (!light.current) {
    const l = new DirectionalLight('#fff1da', 2.1)
    light.current = l
  }
  const dir = useRef(new Vector3())
  useFrame(() => {
    const l = light.current!
    const c = runtime.cam.target
    dir.current.copy(c).multiplyScalar(-1)
    if (dir.current.lengthSq() < 1e-4) dir.current.set(0.6, 0.3, 0.7)
    dir.current.normalize()
    if (uiStore.get().lab) dir.current.set(0.78, 0.32, 0.5).normalize()
    l.position.copy(c).addScaledVector(dir.current, 40)
    l.target.position.copy(c)
    l.target.updateMatrixWorld()
  })
  return (
    <>
      <primitive object={light.current} />
      <primitive object={light.current.target} />
      <ambientLight intensity={0.8} color="#a9bde8" />
    </>
  )
}

export { resolveQuality }
