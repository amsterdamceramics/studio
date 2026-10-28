import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'

/** Which card is open in a side panel. Opening one closes the others, so a panel scans as a short list of headings. */
const PanelOpen = createContext<{ open: string | null; setOpen: (title: string | null) => void } | null>(null)

export function Panel({ open, setOpen, children }: { open: string | null; setOpen: (title: string | null) => void; children: ReactNode }) {
  return <PanelOpen.Provider value={{ open, setOpen }}>{children}</PanelOpen.Provider>
}

/**
 * A card in a side panel. Closed, it shows its title and a one-line summary of its settings; `pinned`
 * cards (the playback controls) are always open.
 */
export function Section({ title, summary, action, pinned, children }: { title: string; summary?: ReactNode; action?: ReactNode; pinned?: boolean; children: ReactNode }) {
  const panel = useContext(PanelOpen)
  const open = pinned || !panel || panel.open === title
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header className="section-head">
        {pinned || !panel ? (
          <h2>{title}</h2>
        ) : (
          <button type="button" className="section-toggle" aria-expanded={open} onClick={() => panel.setOpen(open ? null : title)}>
            <h2>{title}</h2>
            {!open && summary !== undefined && <span className="section-summary">{summary}</span>}
            <svg className="chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {open && action}
      </header>
      {open && children}
    </section>
  )
}

interface SliderProps {
  label: string
  hint?: string
  value: number
  min?: number
  max?: number
  step?: number
  reset?: number
  format?: (v: number) => string
  onChange: (v: number) => void
}

export function Slider({ label, hint, value, min = 0, max = 1, step = 0.01, reset, format, onChange }: SliderProps) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <label className="slider">
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
      {hint && <span className="slider-hint">{hint}</span>}
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

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)}>
      {children}
    </button>
  )
}
