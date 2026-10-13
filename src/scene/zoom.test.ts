import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { dollyTarget, focusWeightAfterZoom, pushOutOfSphere, rayPlaneHit, rayPointDistance, wheelFactor } from './zoom'
import { intentCancel, intentStep, intentWheel, newIntent, proximityDistances, revealAmount, type IntentContext } from './proximity'

describe('zoom geometry', () => {
  it('wheel direction: down zooms out, up zooms in; trackpad deltas are small', () => {
    expect(wheelFactor(100)).toBeGreaterThan(1)
    expect(wheelFactor(-100)).toBeLessThan(1)
    expect(wheelFactor(2)).toBeCloseTo(1.002, 3)
    expect(wheelFactor(100, 1)).toBeCloseTo(wheelFactor(1600), 6) // line mode
    expect(wheelFactor(1e9)).toBeCloseTo(wheelFactor(240), 6) // bounded
  })

  it('ray ↔ plane: hits in front, rejects parallel / behind / too far', () => {
    const o = new Vector3(0, 10, 0)
    expect(rayPlaneHit(o, new Vector3(0, -1, 0), 0, 100)!.toArray()).toEqual([0, 0, 0])
    expect(rayPlaneHit(o, new Vector3(1, -0.01, 0).normalize(), 0, 100)).toBeNull() // grazing
    expect(rayPlaneHit(o, new Vector3(0, 1, 0), 0, 100)).toBeNull() // pointing away
    expect(rayPlaneHit(o, new Vector3(0, -1, 0), 0, 5)).toBeNull() // beyond maxDist
  })

  it('dollying keeps the pivot fixed and scales the view around it', () => {
    const T = new Vector3(0, 0, 0)
    const P = new Vector3(10, 0, 0)
    expect(dollyTarget(T, P, 0.5).toArray()).toEqual([5, 0, 0]) // halfway to the pivot
    expect(dollyTarget(T, P, 1).toArray()).toEqual([0, 0, 0]) // no zoom → no move
    // zooming in then out by the same factor returns to the start
    const there = dollyTarget(T, P, 0.5)
    expect(dollyTarget(there, P, 2).distanceTo(T)).toBeLessThan(1e-9)
  })

  it('focus weight converges geometrically and unwinds symmetrically', () => {
    let w = 0
    for (let i = 0; i < 12; i++) w = focusWeightAfterZoom(w, 0.89)
    expect(w).toBeGreaterThan(0.7)
    expect(w).toBeLessThan(1)
    for (let i = 0; i < 12; i++) w = focusWeightAfterZoom(w, 1 / 0.89)
    expect(w).toBeCloseTo(0, 6)
    expect(focusWeightAfterZoom(0.5, 1e-9)).toBeCloseTo(1, 6)
    expect(focusWeightAfterZoom(0, 5)).toBe(0)
  })

  it('point-ray distance and sphere push-out', () => {
    expect(rayPointDistance(new Vector3(), new Vector3(0, 0, -1), new Vector3(3, 0, -10))).toBeCloseTo(3)
    expect(rayPointDistance(new Vector3(), new Vector3(0, 0, -1), new Vector3(0, 0, 5))).toBe(Infinity)
    const p = new Vector3(1, 0, 0)
    expect(pushOutOfSphere(p, new Vector3(), 2)).toBe(true)
    expect(p.length()).toBeCloseTo(2)
    expect(pushOutOfSphere(new Vector3(5, 0, 0), new Vector3(), 2)).toBe(false)
  })
})

describe('proximity intent (never open a category by accident)', () => {
  const d = proximityDistances(2, 17.3)
  const ctx = (over: Partial<IntentContext> = {}): IntentContext => ({ level: 'universe', busy: false, target: 'p:a', dist: d.enter - 1, enterDist: d.enter, exitDist: d.exit, ...over })
  /** a smooth zoom gesture: n notches, 50 ms apart, ticking the state machine in between */
  function gesture(s: ReturnType<typeof newIntent>, notches: number, key: string | null, c: IntentContext, f = 0.89) {
    let result = 'none'
    for (let i = 0; i < notches; i++) {
      intentWheel(s, key, f)
      for (let k = 0; k < 3; k++) {
        const r = intentStep(s, 1 / 60, c)
        if (r !== 'none') result = r
      }
    }
    return result
  }

  it('thresholds are planet-relative and ordered with real hysteresis', () => {
    expect(d.enter).toBeLessThan(d.revealStart)
    expect(d.exit).toBeGreaterThan(d.enter * 1.6)
    const big = proximityDistances(2.8, 40)
    expect(big.enter).toBeCloseTo(21) // 7.5 × 2.8, not larger than 0.9 × framing
    expect(proximityDistances(4, 20).enter).toBe(18) // capped by the level framing
  })

  it('enters after sustained zoom-in on the same planet, once close enough', () => {
    const s = newIntent()
    expect(gesture(s, 9, 'p:a', ctx())).toBe('enter')
  })

  it('does NOT enter when still far away, however much the user zooms', () => {
    const s = newIntent()
    expect(gesture(s, 20, 'p:a', ctx({ dist: d.enter + 5 }))).toBe('none')
  })

  it('does NOT enter on a different/empty target, nor with too little zoom', () => {
    expect(gesture(newIntent(), 8, null, ctx({ target: null }))).toBe('none')
    expect(gesture(newIntent(), 8, 'p:b', ctx())).toBe('none') // gesture aimed at b, target a
    expect(gesture(newIntent(), 1, 'p:a', ctx())).toBe('none') // a single notch
  })

  it('does NOT enter when the camera merely arrives near a planet without a gesture', () => {
    const s = newIntent()
    for (let i = 0; i < 120; i++) expect(intentStep(s, 1 / 60, ctx())).toBe('none')
  })

  it('does NOT enter while another system owns the camera, and cancel wipes intent', () => {
    expect(gesture(newIntent(), 8, 'p:a', ctx({ busy: true }))).toBe('none')
    const s = newIntent()
    intentWheel(s, 'p:a', 0.5)
    intentCancel(s) // user started rotating
    for (let i = 0; i < 60; i++) expect(intentStep(s, 1 / 60, ctx())).toBe('none')
  })

  it('zoom-out in between resets the accumulated zoom-in', () => {
    const s = newIntent()
    gesture(s, 3, 'p:a', ctx({ dist: d.enter + 5 }))
    intentWheel(s, 'p:a', 1.2)
    expect(s.zoomIn).toBe(0)
    expect(gesture(s, 1, 'p:a', ctx())).toBe('none')
  })

  it('exits only on a zoom-out gesture beyond the exit distance (hysteresis)', () => {
    const planet = (over: Partial<IntentContext>) => ctx({ level: 'planet', target: null, ...over })
    // at the entry distance nothing happens, even with zoom-out gestures
    expect(gesture(newIntent(), 10, null, planet({ dist: d.enter + 2 }), 1.12)).toBe('none')
    // beyond the exit distance, but without a gesture → stays
    const idle = newIntent()
    for (let i = 0; i < 120; i++) expect(intentStep(idle, 1 / 60, planet({ dist: d.exit + 5 }))).toBe('none')
    // gesture + far enough → exits
    expect(gesture(newIntent(), 9, null, planet({ dist: d.exit + 1 }), 1.12)).toBe('exit')
  })

  it('leaving does not depend on what the cursor passes over while zooming out', () => {
    const s = newIntent()
    const c = ctx({ level: 'planet', target: null, dist: d.exit + 1 })
    let result = 'none'
    for (let i = 0; i < 9; i++) {
      intentWheel(s, i % 2 ? 'g:moon' : null, 1.12) // cursor alternates between a moon and empty space
      for (let k = 0; k < 3; k++) {
        const r = intentStep(s, 1 / 60, c)
        if (r !== 'none') result = r
      }
    }
    expect(result).toBe('exit')
  })

  it('reveal ramps 0→1 between the reveal start and the entry distance', () => {
    expect(revealAmount(d.revealStart + 3, d.enter, d.revealStart)).toBe(0)
    expect(revealAmount(d.enter - 2, d.enter, d.revealStart)).toBe(1)
    const mid = revealAmount((d.enter + d.revealStart) / 2, d.enter, d.revealStart)
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThan(0.6)
  })
})
