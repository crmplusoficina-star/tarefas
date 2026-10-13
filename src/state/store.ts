import { useRef, useSyncExternalStore } from 'react'

export interface Store<T> {
  get(): T
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void
  /** replace the whole state */
  replace(next: T): void
  subscribe(fn: () => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch
      state = { ...state, ...p }
      emit()
    },
    replace(next) {
      state = next
      emit()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** Select a slice of a store; re-renders only when the (shallowly compared) slice changes. */
export function useStore<T extends object, S>(store: Store<T>, selector: (s: T) => S): S {
  const cache = useRef<{ value: S } | null>(null)
  const getSnapshot = () => {
    const next = selector(store.get())
    if (cache.current && shallowEqual(cache.current.value, next)) return cache.current.value
    cache.current = { value: next }
    return next
  }
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}
