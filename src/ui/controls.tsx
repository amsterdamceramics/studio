import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { Chevron, ResetIcon } from './icons'

/** Which card is open in a side panel. Opening one closes the others, so a panel scans as a short list of headings. */
const PanelOpen = createContext<{ open: string | null; setOpen: (title: string | null) => void } | null>(null)

export function Panel({ open, setOpen, children }: { open: string | null; setOpen: (title: string | null) => void; children: ReactNode }) {
  return <PanelOpen.Provider value={{ open, setOpen }}>{children}</PanelOpen.Provider>
}

/**
 * A card in a side panel. Closed, it shows its title and a one-line summary of its settings; `pinned`
 * cards (the playback controls) are always open. The chevron stays at the trailing edge, with any
 * actions just before it, so it never moves.
 */
export function Section({ title, summary, action, pinned, children }: { title: string; summary?: ReactNode; action?: ReactNode; pinned?: boolean; children: ReactNode }) {
  const panel = useContext(PanelOpen)
  const open = pinned || !panel || panel.open === title
  const toggle = pinned || !panel ? undefined : () => panel.setOpen(open ? null : title)
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header className={`section-head ${toggle ? 'can-toggle' : ''}`} onClick={toggle}>
        {toggle ? (
          <button type="button" className="section-toggle" aria-expanded={open} onClick={(e) => (e.stopPropagation(), toggle())}>
            <h2>{title}</h2>
          </button>
        ) : (
          <h2>{title}</h2>
        )}
        {!open && summary !== undefined && <span className="section-summary">{summary}</span>}
        {open && action && (
          <span className="section-actions" onClick={(e) => e.stopPropagation()}>
            {action}
          </span>
        )}
        {toggle && (
          <span className="chevron" aria-hidden="true">
            <Chevron />
          </span>
        )}
      </header>
      {open && children}
    </section>
  )
}

/** A small icon-only button; the label is read out and shown as a tooltip. */
export function IconButton({ label, onClick, disabled, children, danger }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; danger?: boolean }) {
  return (
    <button type="button" className={`icon-btn ${danger ? 'danger' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

export function Reset({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="Reset" onClick={onClick}>
      <ResetIcon />
    </IconButton>
  )
}

interface SliderProps {
  label: string
  /** What the control does, shown on hover. */
  hint?: string
  /** Live information worth reading at a glance, shown under the slider. */
  note?: string
  value: number
  min?: number
  max?: number
  step?: number
  reset?: number
  format?: (v: number) => string
  onChange: (v: number) => void
}

export function Slider({ label, hint, note, value, min = 0, max = 1, step = 0.01, reset, format, onChange }: SliderProps) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <label className="slider" title={hint}>
      <span className="slider-row">
        <span className="slider-label">{label}</span>
        <output className="slider-value">{format ? format(value) : Math.round(value * 100)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => reset !== undefined && onChange(reset)}
      />
      {note && <span className="slider-hint">{note}</span>}
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { id: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} aria-label={o.title} title={o.title} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ on, onChange, children, title }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} title={title} onClick={() => onChange(!on)}>
      {children}
    </button>
  )
}
