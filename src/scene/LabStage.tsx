import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Group } from 'three'
import { planetRadius } from '../domain/layout'
import { uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { Beacon } from './Effects'
import { damp } from './math'
import { makeCtl, PlanetBody } from './PlanetBody'
import { ProgressRing } from './ProgressRing'
import type { QualityProfile } from './quality'
import { runtime } from './runtime'

/** The formation chamber: a live preview of the planet being designed. */
export function LabStage({ quality }: { quality: QualityProfile }) {
  const lab = useStore(uiStore, (s) => s.lab)
  const root = useRef<Group>(null)
  const ctl = useMemo(() => makeCtl(), [])
  const presence = useRef(0)
  const nameKey = lab ? `${lab.editingId ?? 'new'}` : ''

  useFrame((_, dt) => {
    const target = uiStore.get().lab ? 1 : 0
    presence.current = runtime.reducedMotion ? target : damp(presence.current, target, target ? 2.4 : 6, Math.min(dt, 0.1))
    ctl.opacity = presence.current
    ctl.light.set(0.78, 0.32, 0.5).normalize()
    if (root.current) {
      root.current.visible = presence.current > 0.01
      root.current.scale.setScalar(0.88 + presence.current * 0.12)
    }
  })

  const draft = lab?.draft
  if (!draft) return <group ref={root} visible={false} />
  const R = planetRadius(draft.style.size) * 1.55
  return (
    <group ref={root} key={nameKey}>
      <PlanetBody style={draft.style} radius={R} ctl={ctl} quality={quality} spin={0.11} />
      <group rotation={[Math.PI / 2 + draft.style.tilt * 0.9 + 0.28, 0, draft.style.tilt * 0.6]}>
        <ProgressRing radius={R * 1.62} thickness={R * 0.05} progress={() => 0.62} opacity={() => ctl.opacity * 0.9} color="#e9c98d" trackAlpha={0.2} />
      </group>
      <Beacon size={R * 3.2} color={draft.style.atmosphere.color} power={3} intensity={() => 0.14 * ctl.opacity * (draft.style.atmosphere.kind === 'none' ? 0 : draft.style.atmosphere.intensity)} />
    </group>
  )
}
