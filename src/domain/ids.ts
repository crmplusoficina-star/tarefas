export function newId(prefix = ''): string {
  const c = globalThis.crypto
  const core =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  return prefix ? `${prefix}_${core}` : core
}
