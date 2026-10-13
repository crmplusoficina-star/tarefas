import { useEffect } from 'react'
import { dismissToast, uiStore } from '../state/uiStore'
import { useStore } from '../state/store'
import { Modal } from './primitives'

export function Toasts() {
  const toasts = useStore(uiStore, (s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass ${t.tone}`}>
          <span className="tone" />
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function ConfirmDialog() {
  const req = useStore(uiStore, (s) => s.confirm)
  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        uiStore.set({ confirm: null })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [req])
  if (!req) return null
  const close = () => uiStore.set({ confirm: null })
  return (
    <Modal
      title={req.title}
      onClose={close}
      labelledBy="confirm-title"
      footer={
        <>
          <span className="grow" />
          <button className="btn ghost" onClick={close}>Cancelar</button>
          <button
            className={`btn ${req.danger ? 'primary' : 'primary'}`}
            data-testid="confirm-ok"
            onClick={() => {
              close()
              req.onConfirm()
            }}
          >
            {req.confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--ink-2)' }}>{req.message}</p>
    </Modal>
  )
}

/** Screen-reader announcements for navigation changes. */
export function LiveRegion() {
  const text = useStore(uiStore, (s) => s.announce)
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  )
}
