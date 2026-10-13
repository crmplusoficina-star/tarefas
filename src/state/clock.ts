import { createStore } from './store'

/** Wall clock sampled every 30 s — enough resolution for deadline urgency. */
export const clockStore = createStore({ now: Date.now() })

let timer: ReturnType<typeof setInterval> | null = null
export function startClock() {
  if (timer) return
  timer = setInterval(() => clockStore.set({ now: Date.now() }), 30_000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) clockStore.set({ now: Date.now() })
  })
}
