import { MathUtils, Vector3 } from 'three'

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const lerp = MathUtils.lerp

/** Frame-rate independent exponential smoothing. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  target + (current - target) * Math.exp(-rate * dt)

const TAU = Math.PI * 2
export const wrapPi = (a: number) => {
  let r = a % TAU
  if (r > Math.PI) r -= TAU
  if (r < -Math.PI) r += TAU
  return r
}

export const dampAngle = (current: number, target: number, rate: number, dt: number) =>
  current + wrapPi(target - current) * (1 - Math.exp(-rate * dt))

export const easeOutBack = (t: number) => {
  const c1 = 1.5
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

/** Critically damped spring (Unity-style SmoothDamp): ease-in/ease-out toward a moving target. */
export interface Smooth {
  v: number
}
export function smoothDamp(current: number, target: number, vel: Smooth, smoothTime: number, dt: number, maxSpeed = Infinity): number {
  const st = Math.max(0.0001, smoothTime)
  const omega = 2 / st
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  let change = current - target
  const maxChange = maxSpeed * st
  change = Math.max(-maxChange, Math.min(maxChange, change))
  const adjustedTarget = current - change
  const temp = (vel.v + omega * change) * dt
  vel.v = (vel.v - omega * temp) * exp
  let out = adjustedTarget + (change + temp) * exp
  if (target - current > 0 === out > target) {
    out = target
    vel.v = (out - target) / dt
  }
  return out
}

export const tmpV = new Vector3()
export const tmpV2 = new Vector3()

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}
