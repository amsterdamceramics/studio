import type { CSSProperties, ReactNode } from 'react'

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
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
