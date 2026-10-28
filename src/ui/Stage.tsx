import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { pathData, type BezierLoop, type Frame } from '../engine'

export interface View {
  outline: boolean
  points: boolean
  ghost: boolean
  actualSize: boolean
}

interface Box {
  id: number
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  /** Each text layer's outlines and colour. */
  paints: { id: number; loops: BezierLoop[]; fill: string }[]
  /** False when the type is only the photo's crop and has no colour of its own. */
  textShown: boolean
  /** Every layer's outlines together, for the outline and points views. */
  loops: BezierLoop[]
  source: BezierLoop[]
  frame: Frame
  background: string
  /** The board without its type (ground plus photo), when a photo is loaded. */
  backdrop?: HTMLCanvasElement | null
  /** Even-odd path data, in board pixels, for where the type may show. */
  typeClip?: string | null
  view: View
  /** Each layer's text box in board pixels. */
  boxes: Box[]
  /** The selected texts. */
  selected: number[]
  /** Text can be picked and dragged: a fixed board, not recording. */
  editable: boolean
  /** `add` is true with shift or ⌘ held: add to the selection or take out, instead of replacing it. */
  onSelect: (id: number, add: boolean) => void
  onMove: (id: number, x: number, y: number) => void
  /** Lines a dragged box's edges and middle snap to, in board pixels. */
  snaps: { x: number[]; y: number[] }
  /** Column and row bands to draw, when the grid is shown. */
  grid: { cols: [number, number][]; rows: [number, number][] } | null
  /** The reel's feed crop and the room Instagram's buttons take, as shares of the board. */
  safe: { top: number; bottom: number; ui: { top: number; bottom: number; side: number } } | null
}

/** How close, in screen pixels, an edge has to come before it snaps. */
const SNAP = 6

/** The nearest snap line to any of `edges`, within reach: how far to move, and the line. */
function snapTo(edges: number[], lines: number[], reach: number) {
  let best: { d: number; line: number } | null = null
  for (const e of edges) for (const l of lines) if (Math.abs(l - e) <= reach && (!best || Math.abs(l - e) < Math.abs(best.d))) best = { d: l - e, line: l }
  return best
}

/** The artboard: live vector paths over the photo. Selection, grid and safe area are drawn here only and never export. */
export function Stage({ paints, textShown, loops, source, frame, background, backdrop, typeClip, view, boxes, selected, editable, onSelect, onMove, snaps, grid, safe }: Props) {
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

  const ds = useMemo(() => paints.map((p) => ({ id: p.id, fill: p.fill, d: pathData(p.loops, frame) })), [paints, frame])
  const all = useMemo(() => (view.outline || view.points ? pathData(loops, frame) : ''), [loops, frame, view.outline, view.points])
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
  const first = paints[0]?.fill
  const light = backdrop && first ? !isLight(first) : isLight(background)
  const ink = light ? '#000' : '#fff'

  const drag = useRef<{ id: number; px: number; py: number; box: Box; moved: boolean } | null>(null)
  const [snapped, setSnapped] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const down = (e: PointerEvent<SVGRectElement>, box: Box) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const add = e.shiftKey || e.metaKey || e.ctrlKey
    onSelect(box.id, add)
    // Shift-clicking only changes the selection; dragging moves the one text under the pointer.
    if (add) return
    drag.current = { id: box.id, px: e.clientX, py: e.clientY, box, moved: false }
  }
  const move = (e: PointerEvent<SVGRectElement>) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.px) / zoom
    const dy = (e.clientY - d.py) / zoom
    if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return
    d.moved = true
    let x = d.box.x + dx
    let y = d.box.y + dy
    // Alt holds off snapping, as in Figma.
    const sx = e.altKey ? null : snapTo([x, x + d.box.w / 2, x + d.box.w], snaps.x, SNAP / zoom)
    const sy = e.altKey ? null : snapTo([y, y + d.box.h / 2, y + d.box.h], snaps.y, SNAP / zoom)
    if (sx) x += sx.d
    if (sy) y += sy.d
    setSnapped({ x: sx?.line ?? null, y: sy?.line ?? null })
    onMove(d.id, Math.round(x), Math.round(y))
  }
  const up = () => {
    drag.current = null
    setSnapped({ x: null, y: null })
  }

  const ui = safe?.ui
  return (
    <div ref={host} className={`stage ${view.actualSize ? 'scroll' : ''}`}>
      <div className="artboard" style={{ width: w * zoom, height: h * zoom, background }}>
        {backdrop && <canvas ref={photo} className="artboard-photo" aria-hidden="true" />}
        <svg width={w * zoom} height={h * zoom} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Generated typography preview">
          {view.ghost && <path d={ghost} fill="none" stroke={ink} strokeOpacity={0.35} strokeWidth={px} strokeDasharray={`${3 * px} ${3 * px}`} />}
          {typeClip && (
            <clipPath id="type-hide">
              <path d={typeClip} clipRule="evenodd" />
            </clipPath>
          )}
          {view.outline || view.points ? (
            <path d={all} fill="none" stroke={ink} strokeWidth={px} />
          ) : (
            textShown && ds.map((p) => <path key={p.id} clipPath={typeClip ? 'url(#type-hide)' : undefined} d={p.d} fill={p.fill} fillRule="nonzero" />)
          )}
          {marks && (
            <>
              <path d={marks.handles} stroke="#ff4d8d" strokeWidth={px * 0.75} fill="none" />
              {marks.nodes.map((n, i) => (
                <rect key={i} x={n.x - 2.5 * px} y={n.y - 2.5 * px} width={5 * px} height={5 * px} fill={light ? '#fff' : '#000'} stroke="#ff4d8d" strokeWidth={px} />
              ))}
            </>
          )}

          {grid && (
            <g aria-hidden="true" pointerEvents="none">
              {grid.cols.map(([a, b], i) => (
                <rect key={`c${i}`} x={a} y={0} width={b - a} height={h} fill="#ff0000" fillOpacity={0.1} />
              ))}
              {grid.rows.map(([a, b], i) => (
                <rect key={`r${i}`} x={0} y={a} width={w} height={b - a} fill="#ff0000" fillOpacity={0.1} />
              ))}
            </g>
          )}
          {safe && ui && (
            <g aria-hidden="true" pointerEvents="none">
              {/* Instagram's own buttons and caption sit over these parts of a reel. */}
              <rect x={0} y={0} width={w} height={h * ui.top} fill="#2f7bff" fillOpacity={0.14} />
              <rect x={0} y={h * (1 - ui.bottom)} width={w} height={h * ui.bottom} fill="#2f7bff" fillOpacity={0.14} />
              <rect x={w * (1 - ui.side)} y={h * ui.top} width={w * ui.side} height={h * (1 - ui.top - ui.bottom)} fill="#2f7bff" fillOpacity={0.14} />
              {/* The 4:5 part the feed shows. */}
              <rect x={px / 2} y={safe.top} width={w - px} height={safe.bottom - safe.top} fill="none" stroke={ink} strokeWidth={px * 1.5} strokeDasharray={`${6 * px} ${4 * px}`} />
            </g>
          )}

          {editable &&
            boxes.map((b) => (
              <rect
                key={b.id}
                className="text-box"
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                fill="transparent"
                stroke={selected.includes(b.id) ? '#C7FF00' : 'none'}
                strokeWidth={px * 1.5}
                onPointerDown={(e) => down(e, b)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
              />
            ))}
          {snapped.x !== null && <line x1={snapped.x} x2={snapped.x} y1={0} y2={h} stroke="#ff4d8d" strokeWidth={px} pointerEvents="none" />}
          {snapped.y !== null && <line x1={0} x2={w} y1={snapped.y} y2={snapped.y} stroke="#ff4d8d" strokeWidth={px} pointerEvents="none" />}
        </svg>
      </div>
    </div>
  )
}

function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150
}
