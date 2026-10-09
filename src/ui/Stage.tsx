import { useEffect, useMemo, useRef, useState } from 'react'
import { pathData, type BezierLoop, type Frame } from '../engine'

export interface View {
  outline: boolean
  points: boolean
  ghost: boolean
  actualSize: boolean
}

interface Props {
  loops: BezierLoop[]
  source: BezierLoop[]
  frame: Frame
  /** Null when the type is only the photo's crop and has no colour of its own. */
  fill: string | null
  background: string
  /** The board without its type (ground plus photo), when a photo is loaded. */
  backdrop?: HTMLCanvasElement | null
  /** Even-odd path data, in board pixels, for where the type may show. */
  typeClip?: string | null
  view: View
}

/** The artboard: one live <path>. Nothing is rasterised; what is shown is what exports. */
export function Stage({ loops, source, frame, fill, background, backdrop, typeClip, view }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const photo = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = photo.current
    if (!canvas || !backdrop) return
    canvas.width = backdrop.width
    canvas.height = backdrop.height
    canvas.getContext('2d')!.drawImage(backdrop, 0, 0)
  }, [backdrop])
  const [room, setRoom] = useState({ w: 800, h: 600 })

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const w = frame.w * frame.scale
  const h = frame.h * frame.scale
  const fit = Math.min((room.w - 64) / w, (room.h - 64) / h)
  const zoom = view.actualSize ? 1 : Math.max(0.01, fit)
  // Overlay marks are sized in screen pixels, whatever the zoom.
  const px = 1 / zoom

  const d = useMemo(() => pathData(loops, frame), [loops, frame])
  const ghost = useMemo(() => (view.ghost ? pathData(source, frame) : ''), [source, frame, view.ghost])

  const marks = useMemo(() => {
    if (!view.points) return null
    const X = (v: number) => (v - frame.x) * frame.scale
    const Y = (v: number) => (v - frame.y) * frame.scale
    let handles = ''
    const nodes: { x: number; y: number }[] = []
    for (const l of loops) {
      let prev = l.start
      for (const s of l.segs) {
        handles += `M${X(prev.x)} ${Y(prev.y)}L${X(s.c1.x)} ${Y(s.c1.y)}M${X(s.p.x)} ${Y(s.p.y)}L${X(s.c2.x)} ${Y(s.c2.y)}`
        nodes.push({ x: X(s.p.x), y: Y(s.p.y) })
        prev = s.p
      }
    }
    return { handles, nodes }
  }, [loops, frame, view.points])

  // Over a photo the overlay ink follows the type colour's opposite, since the ground no longer says much.
  const light = backdrop && fill ? !isLight(fill) : isLight(background)
  const ink = light ? '#000' : '#fff'

  return (
    <div ref={host} className={`stage ${view.actualSize ? 'scroll' : ''}`}>
      <div className="artboard" style={{ width: w * zoom, height: h * zoom, background }}>
        {backdrop && <canvas ref={photo} className="artboard-photo" aria-hidden="true" />}
      <svg
        width={w * zoom}
        height={h * zoom}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Generated typography preview"
      >
        {view.ghost && <path d={ghost} fill="none" stroke={ink} strokeOpacity={0.35} strokeWidth={px} strokeDasharray={`${3 * px} ${3 * px}`} />}
        {typeClip && (
          <clipPath id="type-hide">
            <path d={typeClip} clipRule="evenodd" />
          </clipPath>
        )}
        <path clipPath={typeClip && !view.outline && !view.points ? 'url(#type-hide)' : undefined} d={d} fill={view.outline || view.points || !fill ? 'none' : fill} stroke={view.outline || view.points ? ink : 'none'} strokeWidth={px} fillRule="nonzero" />
        {marks && (
          <>
            <path d={marks.handles} stroke="#ff4d8d" strokeWidth={px * 0.75} fill="none" />
            {marks.nodes.map((n, i) => (
              <rect key={i} x={n.x - 2.5 * px} y={n.y - 2.5 * px} width={5 * px} height={5 * px} fill={light ? '#fff' : '#000'} stroke="#ff4d8d" strokeWidth={px} />
            ))}
          </>
        )}
      </svg>
      </div>
    </div>
  )
}

function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150
}
