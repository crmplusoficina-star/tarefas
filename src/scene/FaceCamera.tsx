import { useFrame, useThree } from '@react-three/fiber'
import { useRef, type ReactNode } from 'react'
import type { Group } from 'three'

/** Keeps its children facing the camera (screen-aligned rings, marks). */
export function FaceCamera({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null)
  const { camera } = useThree()
  useFrame(() => {
    if (ref.current) ref.current.quaternion.copy(camera.quaternion)
  })
  return <group ref={ref}>{children}</group>
}
