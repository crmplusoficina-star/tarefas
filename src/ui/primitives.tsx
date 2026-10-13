import { useEffect, useId, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import { Icon } from './Icon'

/** Text input that keeps a local draft and commits on blur / Enter (Esc reverts). */
export function CommitInput({
  value,
  onCommit,
  multiline,
  className = 'input',
  ...rest
}: {
  value: string
  onCommit: (v: string) => void
  multiline?: boolean
  className?: string
  placeholder?: string
  id?: string
  autoFocus?: boolean
  maxLength?: number
  'aria-label'?: string
  rows?: number
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  const commit = () => {
    focused.current = false
    if (draft !== value) onCommit(draft)
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setDraft(value)
      ;(e.target as HTMLElement).blur()
    } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      ;(e.target as HTMLElement).blur()
    }
  }
  const common = {
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onFocus: () => (focused.current = true),
    onBlur: commit,
    onKeyDown: keys,
    className,
    ...rest,
  }
  return multiline ? <textarea {...common} className={`textarea ${className === 'input' ? '' : className}`} /> : <input {...common} />
}

export function Modal({ title, onClose, children, footer, wide, labelledBy = 'modal-title' }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button.primary')
    first?.focus()
    return () => prev?.focus?.()
  }, [])
  // simple focus trap
  const trap = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const els = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])')
    if (!els || els.length === 0) return
    const first = els[0]!
    const last = els[els.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal glass ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onKeyDown={trap}>
        <div className="panel-head">
          <div className="grow">
            <h2 className="panel-title" id={labelledBy}>
              {title}
            </h2>
          </div>
          <button className="mini-btn" onClick={onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
        <div className="panel-body">{children}</div>
        {footer && <div className="panel-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; color?: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.color && <span className="pip" style={{ background: o.color }} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, format }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => string }) {
  const id = useId()
  return (
    <div className="range-row">
      <label className="rl" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{format ? format(value) : Math.round(value * 100)}</span>
    </div>
  )
}
