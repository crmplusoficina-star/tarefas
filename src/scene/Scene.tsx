import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dataStore } from '../state/dataStore'
import { deselectTask } from '../state/commands'
import { levelOf, pushToast, uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { Sky, Starfield, Sun } from './Backdrop'
import { CameraRig } from './CameraRig'
import { Bursts } from './Effects'
import { FrameDriver, SunLight } from './FrameDriver'
import { LabStage } from './LabStage'
import { PlanetSystem } from './PlanetSystem'
import { PROFILES, resolveQuality } from './quality'
import { runtime, stepDt } from './runtime'
import { Universe } from './Universe'
import { useFrame } from '@react-three/fiber'
import { damp } from './math'

function SunPresence({ presence }: { presence: { current: number } }) {
  useFrame((_, dt) => {
    const s = uiStore.get()
    const target = s.lab ? 0 : levelOf(s) === 'universe' ? 1 : 0.0
    presence.current = runtime.reducedMotion ? target : damp(presence.current, target, 3, stepDt(dt))
  })
  return null
}

export function Scene() {
  const effects = useStore(dataStore, (s) => s.data.settings.effects)
  const autoQuality = useStore(uiStore, (s) => s.autoQuality)
  const quality = PROFILES[resolveQuality(effects, autoQuality)]
  const [antialias] = useState(() => quality.antialias)
  const sunPresence = useRef({ current: 1 })
  const wrapper = useRef<HTMLDivElement>(null)

  const glProps = useMemo(
    () => ({ antialias, powerPreference: 'high-performance' as const, alpha: false, stencil: false }),
    [antialias],
  )

  useEffect(() => {
    const el = wrapper.current?.querySelector('canvas')
    if (!el) return
    const lost = (e: Event) => {
      e.preventDefault()
      pushToast('O contexto gráfico foi interrompido. Tentando restaurar…', 'warn')
    }
    const restored = () => pushToast('Gráficos restaurados.', 'success', undefined, 2500)
    el.addEventListener('webglcontextlost', lost)
    el.addEventListener('webglcontextrestored', restored)
    return () => {
      el.removeEventListener('webglcontextlost', lost)
      el.removeEventListener('webglcontextrestored', restored)
    }
  }, [])

  return (
    <div
      ref={wrapper}
      className="scene"
      role="application"
      aria-label="Mapa espacial do universo. Use Tab para percorrer os objetos, setas para mover a câmera, + e − para o zoom, Esc para voltar."
      tabIndex={0}
      data-testid="scene"
    >
      <Canvas
        dpr={[1, quality.maxDpr]}
        camera={{ fov: 45, near: 0.1, far: 4000, position: [0, 60, 60] }}
        gl={glProps}
        onPointerMissed={() => {
          if (!runtime.dragMoved && levelOf(uiStore.get()) === 'task') deselectTask()
        }}
      >
        <color attach="background" args={['#04060b']} />
        <FrameDriver />
        <CameraRig />
        <SunLight />
        <SunPresence presence={sunPresence.current} />
        <Sky quality={quality} presence={sunPresence.current} />
        <Starfield quality={quality} />
        <Sun quality={quality} presence={sunPresence.current} />
        <Universe quality={quality} />
        <PlanetSystem quality={quality} />
        <LabStage quality={quality} />
        <Bursts />
      </Canvas>
    </div>
  )
}
