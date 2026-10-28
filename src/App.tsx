import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  BRAND_TYPE,
  PLAIN_TYPE,
  EM,
  MOTIONS,
  REST,
  clayFrame,
  pathData,
  canvasBlob,
  PHOTO_EFFECTS,
  WINDOW_STYLES,
  clayWindow,
  clipData,
  PhotoFx,
  composeBackdrop,
  coverPainter,
  gradientMap,
  loadPhoto,
  loadVideo,
  TypeSetter,
  download,
  drawToCanvas,
  frameAt,
  organic,
  pdfBlob,
  pngBlob,
  svgBlob,
  svgDocument,
  type Align,
  type BezierLoop,
  type Frame,
  type BlobShape,
  type GradientMap,
  type ClayCut,
  CLAY_CUT,
  autoClayCut,
  type PhotoEffect,
  type TypeClip,
  type WindowShape,
  type WindowStyle,
  type Placement,
  type Motion,
  type OrganicParams,
} from './engine'
import { COLORS, PRESETS, RAMPS } from './presets'
import { IconButton, Panel, Reset, Section, Segmented, Slider, Toggle } from './ui/controls'
import { AlignBottom, AlignCentre, AlignLeft, AlignMiddle, AlignRight, AlignTop, Minus, Plus } from './ui/icons'
import { Stage, type View } from './ui/Stage'

const BOARDS = [
  { id: 'fit', label: 'Fit', title: 'Hug the type', w: 0, h: 0 },
  { id: 'story', label: '9:16', title: 'Story, 1080 × 1920', w: 1080, h: 1920 },
  { id: 'portrait', label: '4:5', title: 'Portrait post, 1080 × 1350', w: 1080, h: 1350 },
  { id: 'square', label: '1:1', title: 'Square post, 1080 × 1080', w: 1080, h: 1080 },
] as const
type BoardId = (typeof BOARDS)[number]['id']

/** Board-wide settings. Each block of text is a layer of its own. */
interface Type {
  board: BoardId
  /** Room around the type on the Fit board, in em of the first layer. */
  padding: number
}

interface TextLayer {
  id: number
  text: string
  fontSize: number
  align: Align
  /** Clay runs the type through the engine; plain sets the font as it is. */
  style: 'clay' | 'plain'
  /** Leading for plain type only; clay type is fixed. */
  lineHeight: number
  fill: string
  /** Top-left of the text box on a fixed board, in board pixels; null places it by its alignment, centred top to bottom. */
  x: number | null
  y: number | null
}

/** A column and row grid like Figma's stretch layout grids, in board pixels. */
interface Grid {
  columns: number
  side: number
  rows: number
  top: number
  gutter: number
}
const DEFAULT_GRID: Grid = { columns: 5, side: 80, rows: 10, top: 124, gutter: 20 }

/**
 * What a 9:16 reel looks like elsewhere on Instagram, on the 1080 × 1920 board: the 4:5 part the feed
 * shows, the 3:4 part the profile grid shows, and the part left clear of the reel's own buttons and
 * caption (top 14%, bottom 35%, right 6%). Each is drawn as a labelled frame and snapped to.
 */
const FEED_CROP = { top: 285, bottom: 1635, inset: 124 }
const SAFE_FRAMES = [
  { id: 'feed', label: 'Feed 4:5', x: 0, y: 285, w: 1080, h: 1350, dash: 'long' as const },
  { id: 'grid', label: 'Profile grid 3:4', x: 0, y: 240, w: 1080, h: 1440, dash: 'dot' as const },
  { id: 'clear', label: 'Clear of Instagram buttons', x: 0, y: 269, w: 1015, h: 979, dash: 'solid' as const },
]

function gridLines(w: number, h: number, g: Grid) {
  const cw = (w - g.side * 2 - g.gutter * (g.columns - 1)) / g.columns
  const rh = (h - g.top * 2 - g.gutter * (g.rows - 1)) / g.rows
  return {
    cols: Array.from({ length: g.columns }, (_, i) => [g.side + i * (cw + g.gutter), g.side + i * (cw + g.gutter) + cw] as [number, number]),
    rows: Array.from({ length: g.rows }, (_, i) => [g.top + i * (rh + g.gutter), g.top + i * (rh + g.gutter) + rh] as [number, number]),
  }
}

interface Paint {
  id: number
  loops: BezierLoop[]
  fill: string
}

interface Output {
  /** Each layer's outlines in frame space, with its colour. */
  paints: Paint[]
  /** Every layer's outlines together, for the crop shapes and the outline view. */
  loops: BezierLoop[]
  source: BezierLoop[]
  frame: Frame
  /** Each layer's text box, in board pixels. */
  boxes: { id: number; x: number; y: number; w: number; h: number }[]
  /** Room around the type in frame units, for the clay frame. */
  pad: number
  nodes: number
  ms: number
  /** True when the type runs past the board. */
  overflow: boolean
  /** Loop phase this frame was generated at. */
  phase: number
}

const DEFAULT_TYPE: Type = { board: 'fit', padding: 0.35 }
const FIRST_LAYER: TextLayer = { id: 1, text: 'amsterdam\nceramics', fontSize: 160, align: 'left', style: 'clay', lineHeight: PLAIN_TYPE.lineHeight, fill: '#000000', x: null, y: null }

/** Ready-made boards. Text, sizes and places are measured from the studio's own Figma files. */
const ACID = '#C7FF00'
const TEMPLATES: { id: string; label: string; title: string; board: BoardId; layers: Omit<TextLayer, 'id'>[] }[] = [
  {
    id: 'main',
    label: 'Main visual',
    title: 'The 9:16 main visual: clay title, plain strapline, dates and venue',
    board: 'story',
    layers: [
      { text: 'amsterdam\nceramics', style: 'clay', fontSize: 184, align: 'left', lineHeight: PLAIN_TYPE.lineHeight, fill: ACID, x: 80, y: 749 },
      { text: 'Amsterdam’s exhibition for contemporary ceramics', style: 'plain', fontSize: 32, align: 'center', lineHeight: 1.15, fill: ACID, x: null, y: 409 },
      { text: '06 - 07 December 2025\n12:00 - 17:00', style: 'plain', fontSize: 32, align: 'left', lineHeight: 1.15, fill: ACID, x: 80, y: 1435 },
      { text: 'LOODS 6, KNSM-Laan\n143, Amsterdam', style: 'plain', fontSize: 32, align: 'left', lineHeight: 1.15, fill: ACID, x: 644, y: 1435 },
    ],
  },
]

/** The four ways a photo (or, with no photo, a second colour) sits on the board, and the one thing that moves in each. */
const LAYOUTS: { id: 'full' | 'blob' | 'letters' | 'window'; label: string; plain: string; photo: string; colour: string }[] = [
  { id: 'full', label: 'Full board', plain: 'Ground only', photo: 'The photo fills the board. Moves with a photo effect', colour: 'Just the ground colour, no shape' },
  { id: 'blob', label: 'Clay frame', plain: 'Clay shape', photo: 'The photo sits in a clay shape. The shape moves', colour: 'A clay shape in a second colour. The shape moves' },
  { id: 'letters', label: 'Inside the type', plain: 'Inside the type', photo: 'The photo shows through the letters. Moves with the type motion', colour: '' },
  { id: 'window', label: 'Moving window', plain: 'Moving window', photo: 'A drifting opening shows the photo and hides the type', colour: 'A drifting shape in a second colour that hides the type' },
]

const ORGANIC: { key: keyof Omit<OrganicParams, 'seed'>; label: string; hint: string }[] = [
  { key: 'softness', label: 'Softness', hint: 'The blur: rounds corners, fuses what is close' },
  { key: 'blob', label: 'Blob amount', hint: 'The threshold: how heavy the clay sits' },
  { key: 'mergeDistance', label: 'Merge distance', hint: 'Extra reach between neighbouring letters' },
  { key: 'mergeStrength', label: 'Merge strength', hint: 'How full each extra bridge becomes' },
  { key: 'noise', label: 'Noise', hint: 'Hand-made irregularity, same every time' },
  { key: 'counterProtection', label: 'Counter protection', hint: 'Keeps a, e, o and d open' },
  { key: 'edgeSmoothness', label: 'Edge smoothness', hint: 'Relaxes the contour, fewer points' },
]

const mapLoops = (loops: BezierLoop[], k: number, dx: number, dy: number): BezierLoop[] => {
  const m = (p: { x: number; y: number }) => ({ x: p.x * k + dx, y: p.y * k + dy })
  return loops.map((l) => ({ start: m(l.start), segs: l.segs.map((s) => ({ c1: m(s.c1), c2: m(s.c2), p: m(s.p) })) }))
}

/** Still clay layers are remembered, so moving or recolouring a layer does not run the engine again. */
const shapes = new Map<string, { loops: BezierLoop[]; nodes: number; ms: number }>()

/**
 * `phase` is the position in the whole loop; the type runs `cycles` times within it. On the Fit board
 * only the first layer shows and the board hugs it; on a fixed board every layer sits where it is placed.
 */
function render(ts: TypeSetter, type: Type, layers: TextLayer[], grid: Grid, params: OrganicParams, motion: Motion, phase: number, rest: number, cycles = 1): Output {
  const board = BOARDS.find((b) => b.id === type.board)!
  const shown = board.w ? layers : layers.slice(0, 1)
  const fr = frameAt(motion, (phase * cycles) % 1, params, rest)
  const set = shown.map((layer) => {
    const setting = layer.style === 'plain' ? { tracking: PLAIN_TYPE.tracking, lineHeight: layer.lineHeight } : BRAND_TYPE
    const layout = ts.layout({ text: layer.text, align: layer.align, textCase: 'none', ...setting })
    if (layer.style === 'plain') return { layer, layout, loops: layout.source, nodes: layout.source.reduce((n, l) => n + l.segs.length, 0), ms: 0 }
    const key = motion === 'off' ? JSON.stringify([layer.text, layer.align, params]) : ''
    let res = key ? shapes.get(key) : undefined
    if (!res) {
      res = organic(layout.pieces, layout.source, fr.params, fr.mod(layout.box))
      if (key) {
        if (shapes.size > 64) shapes.clear()
        shapes.set(key, res)
      }
    }
    return { layer, layout, loops: res.loops, nodes: res.nodes, ms: res.ms }
  })
  const nodes = set.reduce((n, l) => n + l.nodes, 0)
  const ms = set.reduce((n, l) => n + l.ms, 0)

  if (!board.w) {
    // Fit: the board hugs the first layer, in its own engine units.
    const { layer, layout, loops } = set[0]
    const pad = type.padding * EM
    const scale = layer.fontSize / EM
    const box = layout.box
    const frame: Frame = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2, scale }
    return {
      paints: [{ id: layer.id, loops, fill: layer.fill }],
      loops,
      source: layout.source,
      frame,
      boxes: [{ id: layer.id, x: pad * scale, y: pad * scale, w: box.w * scale, h: box.h * scale }],
      pad,
      nodes,
      ms,
      phase,
      overflow: false,
    }
  }

  // A fixed board is laid out in its own pixels; each layer is scaled to its size and moved to its place.
  const frame: Frame = { x: 0, y: 0, w: board.w, h: board.h, scale: 1 }
  const paints: Paint[] = []
  const boxes: Output['boxes'] = []
  const source: BezierLoop[] = []
  let overflow = false
  for (const { layer, layout, loops } of set) {
    const k = layer.fontSize / EM
    const box = layout.box
    const w = box.w * k
    const h = box.h * k
    const x = layer.x ?? (layer.align === 'left' ? grid.side : layer.align === 'right' ? board.w - grid.side - w : (board.w - w) / 2)
    const y = layer.y ?? (board.h - h) / 2
    paints.push({ id: layer.id, loops: mapLoops(loops, k, x - box.x * k, y - box.y * k), fill: layer.fill })
    source.push(...mapLoops(layout.source, k, x - box.x * k, y - box.y * k))
    boxes.push({ id: layer.id, x, y, w, h })
    if (x < -1 || y < -1 || x + w > board.w + 1 || y + h > board.h + 1) overflow = true
  }
  return { paints, loops: paints.flatMap((p) => p.loops), source, frame, boxes, pad: type.padding * shown[0].fontSize, nodes, ms, phase, overflow }
}

export default function App() {
  const [ts, setTs] = useState<TypeSetter | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<Type>(DEFAULT_TYPE)
  const [params, setParams] = useState<OrganicParams>({ ...PRESETS[0].params, seed: 1 })
  const [layers, setLayers] = useState<TextLayer[]>([FIRST_LAYER])
  // The texts being edited; the last one picked is the one whose words and place the panel shows.
  const [selection, setSelection] = useState<number[]>([FIRST_LAYER.id])
  const setSelected = (id: number) => setSelection([id])
  /** Shift or ⌘ adds a text to the selection or takes it out, as in Figma. */
  const pick = (id: number, add: boolean) =>
    setSelection((sel) => (!add ? [id] : sel.includes(id) ? (sel.length > 1 ? sel.filter((s) => s !== id) : sel) : [...sel, id]))
  const [grid, setGrid] = useState<Grid>(DEFAULT_GRID)
  const [guides, setGuides] = useState({ grid: false, safe: false })
  const [background, setBackground] = useState('#FFFFFF')
  const [transparent, setTransparent] = useState(false)
  const [view, setView] = useState<View>({ outline: false, points: false, ghost: false, actualSize: false })
  const [motionSet, setMotion] = useState<Motion>('off')
  // Plain type has no clay to move, so its motion is simply off while that style is chosen.
  const fixed = BOARDS.find((b) => b.id === type.board)!
  const hasClay = (fixed.w ? layers : layers.slice(0, 1)).some((l) => l.style === 'clay')
  // The Fit board shows only the first text, so that is the one being edited there.
  const chosen = fixed.w ? layers.filter((l) => selection.includes(l.id)) : []
  const layer = (fixed.w && layers.find((l) => l.id === selection[selection.length - 1])) || chosen[0] || layers[0]
  const many = chosen.length > 1
  // Nothing picked: no selection box on the board, and the panel waits for a text to be chosen.
  const none = fixed.w > 0 && chosen.length === 0
  const isChosen = (id: number) => (many ? selection.includes(id) : id === layer.id)
  const motion: Motion = hasClay ? motionSet : 'off'
  // Style, size, alignment and colour change every selected text; the words only ever change the one shown.
  const setL = <K extends keyof TextLayer>(key: K, v: TextLayer[K]) =>
    setLayers((all) => all.map((l) => (l.id === layer.id || (key !== 'text' && isChosen(l.id)) ? { ...l, [key]: v } : l)))
  const moveLayer = useCallback((id: number, x: number, y: number) => setLayers((all) => all.map((l) => (l.id === id ? { ...l, x, y } : l))), [])
  const addLayer = () => {
    const id = Math.max(...layers.map((l) => l.id)) + 1
    setLayers([...layers, { ...FIRST_LAYER, id, text: 'New text', style: 'plain', fontSize: 48, fill: layer.fill, x: null, y: null }])
    setSelected(id)
  }
  const deleteLayer = () => {
    if (layers.length < 2) return
    // Deletes every selected text, but always leaves one.
    const gone = (l: TextLayer) => isChosen(l.id)
    const at = layers.findIndex(gone)
    const rest = layers.filter((l) => !gone(l))
    if (!rest.length) return
    setLayers(rest)
    setSelected(rest[Math.max(0, at - 1)].id)
  }
  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setType((tp) => ({ ...tp, board: t.board }))
    setLayers(t.layers.map((l, i) => ({ ...l, id: i + 1 })))
    setSelected(1)
    setGrid(DEFAULT_GRID)
    setGuides({ grid: true, safe: t.board === 'story' })
  }
  const [playing, setPlaying] = useState(true)
  const [phase, setPhase] = useState(0)
  const [out, setOut] = useState<Output | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [loops, setLoops] = useState<'1' | '2' | '3'>('2')
  // Each motion keeps its own resting amount.
  const [restBy, setRestBy] = useState<Partial<Record<Motion, number>>>({})
  const restOf = (m: Motion) => restBy[m] ?? REST[m].start
  const [tab, setTab] = useState<'type' | 'image'>('type')
  // The open card in each side panel; each tab opens on its first card.
  const [leftOpen, setLeftOpen] = useState<string | null>('Text')
  const [rightOpen, setRightOpen] = useState<string | null>('Clay')
  // A photo, or a video: then `canvas` is a still of its first frame and `video` plays underneath.
  const [photo, setPhoto] = useState<{ canvas: HTMLCanvasElement; name: string; video?: HTMLVideoElement; duration?: number } | null>(null)
  // The section of a video that plays and loops, in seconds.
  const [trim, setTrim] = useState({ start: 0, end: 0 })
  const [keepSound, setKeepSound] = useState(false)
  // Bumped when a paused video lands on a new frame, so the board redraws with it.
  const [frameTick, setFrameTick] = useState(0)
  const [gmap, setGmap] = useState<GradientMap>({ enabled: true, shadow: RAMPS[0].shadow, highlight: RAMPS[0].highlight, contrast: 0, brightness: 0 })
  // Colouring the photo: a gradient map, or Clay cut, two flat colours cut from it like the type.
  const [look, setLook] = useState<'map' | 'cut'>('map')
  const [cut, setCut] = useState<ClayCut>(CLAY_CUT)
  const [place, setPlace] = useState<Placement>({ zoom: 1, x: 0, y: 0 })
  const [dropping, setDropping] = useState(false)
  const [crop, setCrop] = useState<'full' | 'blob' | 'letters' | 'window'>('full')
  const [windowShape, setWindowShape] = useState<WindowShape>({ style: 'roam', size: 0.5, seed: 1, round: 0.5 })
  const [hideType, setHideType] = useState(true)
  // With no photo, a shape is filled with a second colour instead.
  const [shapeFill, setShapeFill] = useState('#968FC1')
  const [blob, setBlob] = useState<BlobShape>({ seed: 1, size: 0.9 })
  const [shapeMotion, setShapeMotion] = useState<Motion | 'follow'>('follow')
  const [shapeSpeed, setShapeSpeed] = useState(1)
  const [typeSpeed, setTypeSpeed] = useState(1)
  const [effect, setEffect] = useState<PhotoEffect>('off')
  // Each effect keeps its own speed and strength, so switching between them does not lose a setting.
  const [fxTune, setFxTune] = useState<Partial<Record<PhotoEffect, { speed: number; strength: number }>>>({})
  const tune = fxTune[effect] ?? { speed: 1, strength: 1 }
  const setTune = (patch: Partial<{ speed: number; strength: number }>) => setFxTune((all) => ({ ...all, [effect]: { ...tune, ...patch } }))
  const [fxSeed, setFxSeed] = useState(1)
  const [swapTo, setSwapTo] = useState(RAMPS[1].id)
  // One WebGL renderer for the photo, made on first use; null if the browser has none.
  const [fx] = useState(() => PhotoFx.create())
  const phaseRef = useRef(0)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}fonts/InstrumentSans-Bold.ttf`)
      .then((r) => {
        if (!r.ok) throw new Error(`Font request failed (${r.status})`)
        return r.arrayBuffer()
      })
      .then((buf) => setTs(new TypeSetter(buf)))
      .catch((e: Error) => setError(e.message))
  }, [])

  // The photo itself never moves. Its clay shape can, either with the type or on a motion of its own;
  // type and shape share one loop so a recording closes on both.
  const shapeMove: Motion = crop === 'blob' ? (shapeMotion === 'follow' ? motion : shapeMotion) : 'off'
  // One moving thing per layout: a photo effect belongs to the full-board layout only.
  // Clay cut is a look of its own, so the effects, which work on the gradient map's tones, stand down.
  const liveEffect: PhotoEffect = crop === 'full' && look === 'map' ? effect : 'off'
  const fxOn = !!photo && !!fx && liveEffect !== 'off'
  const clip = photo?.video ? Math.max(0.5, trim.end - trim.start) : 0
  const moving = motion !== 'off' || shapeMove !== 'off' || fxOn || crop === 'window' || clip > 0
  const rest = restOf(motion)
  const shapeRest = restOf(shapeMove)
  const animating = moving && playing && !recording
  // Any speed, and the loop still closes. With still type the loop is simply one shape cycle long.
  // With moving type both have to land on a whole number of cycles, so the loop is stretched to the
  // shortest few type cycles in which the shape can do that, and the shape takes the nearest speed.
  const windowOn = crop === 'window'
  const WINDOW_SECONDS = 8
  const shapeOn = shapeMove !== 'off' || windowOn
  const base = motion !== 'off' ? (MOTIONS.find((m) => m.id === motion)?.seconds ?? 5) : windowOn ? WINDOW_SECONDS : (MOTIONS.find((m) => m.id === shapeMove)?.seconds ?? 5)
  const FX_SECONDS = 6
  const timing = (() => {
    // The type's speed just sets how long one of its cycles lasts; the shape's speed is measured against that cycle.
    // A photo effect on its own sets the loop.
    if (motion === 'off' && !shapeOn) return { typeCycles: 1, shapeCycles: 1, seconds: FX_SECONDS / tune.speed, speed: 1 }
    if (!shapeOn) return { typeCycles: 1, shapeCycles: 1, seconds: base / typeSpeed, speed: 1 }
    if (motion === 'off') return { typeCycles: 1, shapeCycles: 1, seconds: base / shapeSpeed, speed: shapeSpeed }
    let best = { n: 1, k: 1, err: Infinity }
    for (let n = 1; n <= 4; n++) {
      const k = Math.max(1, Math.round(n * shapeSpeed))
      const err = Math.abs(k / n - shapeSpeed)
      if (err < best.err - 0.04) best = { n, k, err }
    }
    return { typeCycles: best.n, shapeCycles: best.k, seconds: (base * best.n) / typeSpeed, speed: best.k / best.n }
  })()
  // With a video the clip sets the loop, and everything else runs a whole number of times inside it.
  const shapeBase = windowOn ? WINDOW_SECONDS : (MOTIONS.find((m) => m.id === shapeMove)?.seconds ?? 5)
  const { typeCycles, shapeCycles, seconds } = clip
    ? {
        seconds: clip,
        typeCycles: motion !== 'off' ? Math.max(1, Math.round((clip * typeSpeed) / (MOTIONS.find((m) => m.id === motion)?.seconds ?? 5))) : 1,
        shapeCycles: shapeOn ? Math.max(1, Math.round((clip * shapeSpeed) / shapeBase)) : 1,
      }
    : timing
  // Alongside type or shape motion the effect has to finish on a whole number of cycles per loop,
  // so it takes the nearest speed that does.
  const fxAlone = motion === 'off' && !shapeOn && !clip
  const fxCycles = fxAlone ? 1 : Math.max(1, Math.round((seconds * tune.speed) / FX_SECONDS))
  const fxActual = fxAlone ? tune.speed : (fxCycles * FX_SECONDS) / seconds

  useEffect(() => {
    if (!ts || animating || recording) return
    const raf = requestAnimationFrame(() => setOut(render(ts, type, layers, grid, params, motion, moving ? phase : 0, rest, typeCycles)))
    return () => cancelAnimationFrame(raf)
  }, [ts, type, layers, grid, params, motion, phase, animating, recording, rest, moving, typeCycles, frameTick])

  useEffect(() => {
    if (!ts || !animating) return
    let raf = 0
    const origin = performance.now() - phaseRef.current * seconds * 1000
    const video = photo?.video
    if (video) {
      // The video is the clock: it plays natively, and the loop phase is read from where it is.
      video.currentTime = trim.start + phaseRef.current * clip
      void video.play().catch(() => {})
    }
    const loop = (now: number) => {
      let p = (((now - origin) / 1000 / seconds) % 1 + 1) % 1
      if (video) {
        // Wrap at the trim. A file can also end a little before its stated length, so an ended or
        // stalled clip is sent back to the start and played again.
        if (video.ended || video.currentTime >= trim.start + clip - 0.03 || video.currentTime < trim.start - 0.05) {
          video.currentTime = trim.start
          void video.play().catch(() => {})
        } else if (video.paused) {
          void video.play().catch(() => {})
        }
        p = Math.min(0.9999, Math.max(0, (video.currentTime - trim.start) / clip))
      }
      phaseRef.current = p
      setOut(render(ts, type, layers, grid, params, motion, p, rest, typeCycles))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      video?.pause()
      setPhase(phaseRef.current)
    }
  }, [ts, type, layers, grid, params, motion, animating, seconds, rest, typeCycles, photo, trim.start, clip])

  // Paused on a video: show the frame at the scrubbed position once the browser has it.
  useEffect(() => {
    const video = photo?.video
    if (!video || animating || recording) return
    video.pause()
    const target = trim.start + phase * clip
    if (Math.abs(video.currentTime - target) < 0.01) return
    const landed = () => setFrameTick((n) => n + 1)
    video.addEventListener('seeked', landed, { once: true })
    video.currentTime = target
    return () => video.removeEventListener('seeked', landed)
  }, [photo, animating, recording, phase, trim.start, clip])

  // Undo. Everything that makes up the artwork is gathered into one snapshot; a change is committed
  // to history once it has settled for a moment, so dragging a slider is one step, not hundreds.
  const snap = { type, layers, grid, params, background, transparent, motion: motionSet, typeSpeed, restBy, photo, trim, gmap, look, cut, place, crop, blob, windowShape, hideType, shapeFill, shapeMotion, shapeSpeed, effect, fxTune, fxSeed, swapTo }
  type Snap = typeof snap
  const sameAs = (a: Snap, b: Snap) => (Object.keys(a) as (keyof Snap)[]).every((k) => a[k] === b[k])
  const history = useRef<{ committed: Snap; undo: Snap[]; redo: Snap[] } | null>(null)
  const [steps, setSteps] = useState({ undo: 0, redo: 0 })
  useEffect(() => {
    const h = (history.current ??= { committed: snap, undo: [], redo: [] })
    if (sameAs(snap, h.committed)) return
    const timer = setTimeout(() => {
      h.undo.push(h.committed)
      if (h.undo.length > 80) h.undo.shift()
      h.redo = []
      h.committed = snap
      setSteps({ undo: h.undo.length, redo: 0 })
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, Object.values(snap))

  const restore = (to: Snap) => {
    const h = history.current
    if (!h) return
    h.committed = to
    apply(to)
    setSteps({ undo: h.undo.length, redo: h.redo.length })
  }
  /** Set every part of the artwork from a snapshot. */
  const apply = (to: Snap) => {
    // The renderer holds the photo's pixels, so it has to be handed the old photo before the frame draws.
    if (to.photo && to.photo !== photo) fx?.setPhoto(to.photo.canvas)
    setType(to.type)
    setParams(to.params)
    setLayers(to.layers)
    setGrid(to.grid)
    setBackground(to.background)
    setTransparent(to.transparent)
    setMotion(to.motion)
    setTypeSpeed(to.typeSpeed)
    setRestBy(to.restBy)
    setPhoto(to.photo)
    setTrim(to.trim)
    setGmap(to.gmap)
    setLook(to.look)
    setCut(to.cut)
    setPlace(to.place)
    setCrop(to.crop)
    setBlob(to.blob)
    setWindowShape(to.windowShape)
    setHideType(to.hideType)
    setShapeFill(to.shapeFill)
    setShapeMotion(to.shapeMotion)
    setShapeSpeed(to.shapeSpeed)
    setEffect(to.effect)
    setFxTune(to.fxTune)
    setFxSeed(to.fxSeed)
    setSwapTo(to.swapTo)
  }

  // Saved templates: the whole design except the photo or video, which each person brings themselves.
  // They live in this browser; a file carries them to someone else's.
  type Design = Omit<Snap, 'photo' | 'trim'>
  const [saved, setSaved] = useState<SavedTemplate<Design>[]>(() => loadTemplates<Design>())
  useEffect(() => storeTemplates(saved), [saved])
  const [naming, setNaming] = useState<string | null>(null)
  const designOf = (): Design => {
    const { photo: _p, trim: _t, ...design } = snap
    return design
  }
  const saveTemplate = (name: string) => {
    const label = name.trim() || `Template ${saved.length + 1}`
    setSaved([...saved, { id: `${Date.now()}`, name: label, design: designOf() }])
    setNaming(null)
    flash(`Saved “${label}”`)
  }
  const useSaved = (t: SavedTemplate<Design>) => {
    // Older files may miss settings added since; those keep what is on the board now.
    apply({ ...snap, ...t.design, photo, trim })
    setSelection([])
    setGuides((g) => ({ ...g, safe: g.safe && t.design.type?.board === 'story' }))
  }
  const exportTemplates = () => {
    download('ac-studio-templates.json', new Blob([JSON.stringify({ app: 'amsterdam-ceramics-studio', version: 1, templates: saved }, null, 2)], { type: 'application/json' }))
  }
  const importTemplates = async (file: File | undefined) => {
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      const list: SavedTemplate<Design>[] = Array.isArray(data?.templates) ? data.templates : []
      const fresh = list.filter((t) => t && typeof t.name === 'string' && t.design && Array.isArray(t.design.layers))
      if (!fresh.length) return flash('No templates in that file')
      setSaved([...saved, ...fresh.map((t, i) => ({ ...t, id: `${Date.now()}-${i}` }))])
      flash(`Added ${fresh.length} template${fresh.length === 1 ? '' : 's'}`)
    } catch {
      flash('Could not read that file')
    }
  }
  const undo = () => {
    const h = history.current
    if (!h) return
    // A change still settling has not been committed yet: stepping back means dropping it.
    const target = sameAs(snap, h.committed) ? h.undo.pop() : h.committed
    if (!target) return
    h.redo.push(snap)
    restore(target)
  }
  const redo = () => {
    const h = history.current
    const target = h?.redo.pop()
    if (!h || !target) return
    h.undo.push(h.committed)
    restore(target)
  }
  /** Arrow keys move the selected text on a fixed board, 1 px at a time, 10 with shift. */
  const nudge = (key: string, by: number) => {
    const box = fixed.w && !none ? out?.boxes.find((b) => b.id === layer.id) : null
    if (!box) return false
    const dx = key === 'ArrowLeft' ? -by : key === 'ArrowRight' ? by : 0
    const dy = key === 'ArrowUp' ? -by : key === 'ArrowDown' ? by : 0
    moveLayer(layer.id, Math.round(box.x + dx), Math.round(box.y + dy))
    return true
  }
  const clear = () => setSelection([])
  /**
   * Single-key shortcuts, as in Figma: ⇧G grid, ⇧S safe area, ⌘A select every text, ⌫ delete the
   * selected texts, T add a text, Space play or pause. Returns true when the key was used.
   */
  const shortcut = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    const mod = e.metaKey || e.ctrlKey
    if (e.shiftKey && !mod && k === 'g' && fixed.w) return setGuides((g) => ({ ...g, grid: !g.grid })), true
    if (e.shiftKey && !mod && k === 's' && story) return setGuides((g) => ({ ...g, safe: !g.safe })), true
    if (mod && !e.shiftKey && k === 'a' && fixed.w) return setSelection(layers.map((l) => l.id)), true
    if ((k === 'backspace' || k === 'delete') && !mod && fixed.w && !none && chosen.length < layers.length) return deleteLayer(), true
    if (k === 't' && !mod && !e.shiftKey && fixed.w) return addLayer(), true
    if (k === ' ' && moving) return setPlaying((p) => !p), true
    return false
  }
  const keys = useRef({ undo, redo, nudge, clear, shortcut })
  useEffect(() => {
    keys.current = { undo, redo, nudge, clear, shortcut }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
        keys.current.clear()
        return
      }
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
      if (!typing && keys.current.shortcut(e)) {
        e.preventDefault()
        return
      }
      if (e.key.startsWith('Arrow') && !typing) {
        keys.current.nudge(e.key, e.shiftKey ? 10 : 1) && e.preventDefault()
        return
      }
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      // Inside the text box, leave the browser's own text undo alone.
      if (e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      if (e.shiftKey) keys.current.redo()
      else keys.current.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A trackpad pinch arrives as a wheel event with ctrl held; left alone it zooms the whole page, which
  // is easy to do by accident and hard to undo inside an app window. The board has its own 100% toggle.
  useEffect(() => {
    const stop = (e: Event) => {
      if (e instanceof WheelEvent && !e.ctrlKey) return
      e.preventDefault()
    }
    window.addEventListener('wheel', stop, { passive: false })
    window.addEventListener('gesturestart', stop)
    return () => {
      window.removeEventListener('wheel', stop)
      window.removeEventListener('gesturestart', stop)
    }
  }, [])

  const flash = useCallback((msg: string) => {
    setNote(msg)
    setTimeout(() => setNote(null), 1800)
  }, [])

  const name = useMemo(() => {
    const slug = layers[0].text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    return `ac-${slug || 'type'}`
  }, [layers])

  const finalFrame = () => (ts ? render(ts, type, layers, grid, params, motion, moving ? phaseRef.current : 0, rest, typeCycles) : null)

  const bg = transparent ? null : background

  // Without WebGL the photo is treated once on the CPU and shown without effects.
  const treated = useMemo(() => (photo && !fx ? gradientMap(photo.canvas, gmap) : null), [photo, fx, gmap])

  /** The shape the photo is cropped to for a given frame, in engine space; null for the full board. */
  const windows = useRef(new WeakMap<Output, { shape: WindowShape; cycles: number; loops: BezierLoop[] }>())
  const cropFor = useCallback(
    (o: Output) => {
      if (crop === 'window') {
        // The photo and the type are both clipped by this outline, so it is worked out once per frame.
        // It is remembered against the settings it was drawn with, so a changed slider redraws it at once.
        let hit = windows.current.get(o)
        if (!hit || hit.shape !== windowShape || hit.cycles !== shapeCycles) {
          hit = { shape: windowShape, cycles: shapeCycles, loops: clayWindow(o.frame, windowShape, (o.phase * shapeCycles) % 1) }
          windows.current.set(o, hit)
        }
        return hit.loops
      }
      if (crop === 'letters') return o.loops
      if (crop === 'blob') return clayFrame(o.frame, o.pad, blob, shapeMove !== 'off' ? { motion: shapeMove, phase: (o.phase * shapeCycles) % 1, rest: shapeRest } : undefined)
      return null
    },
    [crop, blob, windowShape, shapeMove, shapeCycles, shapeRest],
  )
  /** Where the type may show. With a window, the moving layer sits above the type and hides it. */
  const typeClipFor = useCallback(
    (o: Output): TypeClip | null => {
      if (crop !== 'window' || !hideType) return null
      const loops = cropFor(o)
      // Drifting cover: the type lies on the photo and the patches cover it. Otherwise it lies on the ground and the photo covers it.
      return loops ? { loops, inverse: windowShape.style !== 'cover' } : null
    },
    [crop, hideType, windowShape.style, cropFor],
  )

  /** The board without its type for a frame. `bare` gives just the photo, uncropped, for vector exports. */
  const backdropFor = useCallback(
    (o: Output, density: number, bare = false) => {
      // No photo and no shape: the board is just its ground, which needs no backdrop.
      if (!photo && crop !== 'blob' && crop !== 'window') return null
      const w = Math.round(o.frame.w * o.frame.scale)
      const h = Math.round(o.frame.h * o.frame.scale)
      const shape = bare ? null : cropFor(o)
      const to = RAMPS.find((r) => r.id === swapTo) ?? RAMPS[0]
      const paint = !photo
        ? (ctx: CanvasRenderingContext2D, cw: number, ch: number) => {
            ctx.fillStyle = shapeFill
            ctx.fillRect(0, 0, cw, ch)
          }
        : fx
        ? (ctx: CanvasRenderingContext2D, cw: number, ch: number) => {
            // A video hands the renderer whatever frame it is showing right now.
            if (photo.video) fx.setFrame(photo.video)
            return ctx.drawImage(fx.render({ width: cw, height: ch, place, map: gmap, effect: liveEffect, phase: (o.phase * fxCycles) % 1, strength: tune.strength, swapTo: to, seed: fxSeed, cut: look === 'cut' ? cut : null }), 0, 0, cw, ch)
          }
        : treated
          ? coverPainter(treated, place)
          : null
      return composeBackdrop(w * density, h * density, w, background, paint, { clip: shape ? pathData(shape, o.frame) : undefined, bare })
    },
    [photo, fx, treated, gmap, look, cut, liveEffect, swapTo, fxSeed, fxCycles, tune.strength, place, background, cropFor, crop, shapeFill],
  )
  const backdrop = useMemo(() => (out ? backdropFor(out, 1) : null), [out, backdropFor])
  const typeHide = useMemo(() => {
    const clip = out ? typeClipFor(out) : null
    return out && clip ? clipData(clip, out.frame) : null
  }, [out, typeClipFor])
  // Inside the letters, the photo is the fill, so the type has no colour of its own.
  const lettersOnly = !!photo && crop === 'letters'
  const textOf = (o: Output) => (lettersOnly ? [] : o.paints)

  const addPhoto = async (file: File | undefined) => {
    if (!file) return
    if (file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(file.name)) {
      if (!fx) return flash('Video needs WebGL, which this browser does not have')
      try {
        photo?.video?.pause()
        const { video, still, duration } = await loadVideo(file)
        fx.setPhoto(still)
        setPhoto({ canvas: still, name: file.name, video, duration })
        setTrim({ start: 0, end: duration })
        setPlace({ zoom: 1, x: 0, y: 0 })
        phaseRef.current = 0
        setPhase(0)
        setPlaying(true)
      } catch (e) {
        flash((e as Error).message)
      }
      return
    }
    if (!file.type.startsWith('image/')) return flash('That file is not a photo or a video')
    try {
      photo?.video?.pause()
      const canvas = await loadPhoto(file)
      // Hand the photo to the renderer before the first frame asks for it.
      fx?.setPhoto(canvas)
      setPhoto({ canvas, name: file.name })
      setPlace({ zoom: 1, x: 0, y: 0 })
    } catch {
      flash('Could not read that image')
    }
  }

  const exportAs = async (kind: 'svg' | 'png' | 'pdf' | 'copy') => {
    const o = finalFrame()
    if (!o) return
    try {
      // With a photo, vector formats carry it as one embedded picture under the type; crop and type stay vector.
      const shape = cropFor(o) ?? undefined
      const hide = typeClipFor(o) ?? undefined
      // Without a photo the shape is a flat colour, which vector formats carry as a plain filled path.
      const flat = !photo && shape && crop !== 'letters' ? { loops: shape, fill: shapeFill } : undefined
      const picture = kind === 'png' || !photo ? null : backdropFor(o, 2, true)
      const jpeg = picture ? await canvasBlob(picture, 'image/jpeg', 0.92) : null
      const image = jpeg && (kind === 'svg' || kind === 'copy') ? { href: await dataUrl(jpeg), clip: shape } : undefined
      if (kind === 'svg') download(`${name}.svg`, svgBlob(textOf(o), o.frame, bg, image, hide, flat))
      if (kind === 'pdf') {
        const page = jpeg && picture ? { jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: picture.width, height: picture.height, clip: shape } : undefined
        download(`${name}.pdf`, pdfBlob(textOf(o), o.frame, bg, page, hide, flat))
      }
      if (kind === 'png') download(`${name}.png`, await pngBlob(textOf(o), o.frame, bg, 2, backdropFor(o, 2), hide))
      if (kind === 'copy') {
        await navigator.clipboard.writeText(svgDocument(textOf(o), o.frame, bg, image, hide, flat))
        flash('SVG copied')
        return
      }
      flash(`${kind.toUpperCase()} saved`)
    } catch (e) {
      flash(`Export failed: ${(e as Error).message}`)
    }
  }

  const audioGraph = useRef<{ audio: AudioContext; dest: MediaStreamAudioDestinationNode; video: HTMLVideoElement } | null>(null)
  const record = async () => {
    if (!ts || !moving || recording) return
    const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
    if (!mime) return flash('This browser cannot record video')
    setRecording(true)
    const first = render(ts, type, layers, grid, params, motion, 0, rest, typeCycles)
    const canvas = document.createElement('canvas')
    // One video pixel per board pixel, so a 1080 × 1920 board is a 1080 × 1920 file. Video encoders need even sizes.
    canvas.width = Math.round((first.frame.w * first.frame.scale) / 2) * 2
    canvas.height = Math.round((first.frame.h * first.frame.scale) / 2) * 2
    const ctx = canvas.getContext('2d')!
    const density = canvas.width / Math.round(first.frame.w * first.frame.scale)
    const count = Number(loops)
    const video = photo?.video
    const stream = canvas.captureStream(60)
    if (video && keepSound) {
      // The clip's sound is routed into the recording only, so nothing plays out loud while it records.
      const graph = (audioGraph.current ??= (() => {
        const audio = new AudioContext()
        const dest = audio.createMediaStreamDestination()
        audio.createMediaElementSource(video).connect(dest)
        return { audio, dest, video }
      })())
      if (graph.video === video) {
        void graph.audio.resume()
        video.muted = false
        for (const t of graph.dest.stream.getAudioTracks()) stream.addTrack(t)
      }
    }
    if (video) {
      video.currentTime = trim.start
      await new Promise((r) => video.addEventListener('seeked', r, { once: true }))
      void video.play().catch(() => {})
    }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = () => {
      if (video) {
        video.pause()
        video.muted = true
      }
      download(`${name}-${motion !== 'off' ? motion : windowOn ? windowShape.style : shapeMove !== 'off' ? shapeMove : effect}.${mime.includes('mp4') ? 'mp4' : 'webm'}`, new Blob(chunks, { type: mime }))
      setRecording(false)
      flash('Video saved')
    }
    const start = performance.now()
    const step = (now: number) => {
      const t = (now - start) / 1000 / seconds
      let p = t >= count ? 0.9999 : t % 1
      if (video) {
        // The clip keeps the time: wrap it at the trim, and read the phase from where it is.
        if (video.ended || video.currentTime >= trim.start + clip - 0.03) {
          video.currentTime = trim.start
          void video.play().catch(() => {})
        }
        p = t >= count ? 0.9999 : Math.min(0.9999, Math.max(0, (video.currentTime - trim.start) / clip))
      }
      // The last frame sits just short of the seam, so the file itself also repeats cleanly.
      const o = render(ts, type, layers, grid, params, motion, p, rest, typeCycles)
      drawToCanvas(ctx, textOf(o), o.frame, background, backdropFor(o, density), typeClipFor(o))
      setOut(o)
      if (t < count) requestAnimationFrame(step)
      else rec.stop()
    }
    drawToCanvas(ctx, textOf(first), first.frame, background, backdropFor(first, density), typeClipFor(first))
    rec.start()
    requestAnimationFrame(step)
  }

  const placeLayer = (where: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const box = out?.boxes.find((b) => b.id === layer.id)
    if (!box || !fixed.w) return
    const x = where === 'left' ? grid.side : where === 'center' ? (fixed.w - box.w) / 2 : where === 'right' ? fixed.w - grid.side - box.w : box.x
    const y = where === 'top' ? grid.top : where === 'middle' ? (fixed.h - box.h) / 2 : where === 'bottom' ? fixed.h - grid.top - box.h : box.y
    moveLayer(layer.id, Math.round(x), Math.round(y))
  }
  // What the board shows and snaps to while placing text: board edges and middle always, the grid and the reel's safe lines when shown.
  const story = type.board === 'story'
  const lines = useMemo(() => (fixed.w ? gridLines(fixed.w, fixed.h, grid) : null), [fixed.w, fixed.h, grid])
  const snaps = useMemo(() => {
    if (!fixed.w || !lines) return { x: [], y: [] }
    const x = [0, fixed.w / 2, fixed.w]
    const y = [0, fixed.h / 2, fixed.h]
    if (guides.grid) {
      x.push(...lines.cols.flat())
      y.push(...lines.rows.flat())
    }
    if (guides.safe && story) {
      y.push(FEED_CROP.top + FEED_CROP.inset, FEED_CROP.bottom - FEED_CROP.inset)
      for (const f of SAFE_FRAMES) {
        y.push(f.y, f.y + f.h)
        if (f.x + f.w < fixed.w) x.push(f.x + f.w)
      }
    }
    return { x, y }
  }, [fixed.w, fixed.h, lines, guides, story])
  const setP = (key: keyof OrganicParams, v: number) => setParams((p) => ({ ...p, [key]: v }))
  const setT = <K extends keyof Type>(key: K, v: Type[K]) => setType((t) => ({ ...t, [key]: v }))
  const activePreset = PRESETS.find((pr) => ORGANIC.every((o) => Math.abs(pr.params[o.key] - params[o.key]) < 0.005))?.id

  const shownPhase = animating ? (out?.phase ?? 0) : phase
  const size = out ? `${Math.round(out.frame.w * out.frame.scale)} × ${Math.round(out.frame.h * out.frame.scale)}` : ''

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-icon" src={`${import.meta.env.BASE_URL}apple-touch-icon.png`} alt="" width={30} height={30} />
          <span className="brand-name">
            Amsterdam Ceramics <span className="brand-tool">Studio</span>
          </span>
        </div>
        <div className="view-toggles">
          <button type="button" className="toggle" onClick={undo} disabled={steps.undo === 0} title="Undo the last change (⌘Z)">Undo</button>
          <button type="button" className="toggle" onClick={redo} disabled={steps.redo === 0} title="Redo (⇧⌘Z)">Redo</button>
          <span className="divider" aria-hidden="true" />
          <Toggle on={view.actualSize} onChange={(v) => setView({ ...view, actualSize: v })}>100%</Toggle>
          {fixed.w > 0 && (
            <>
              <span className="divider" aria-hidden="true" />
              <Toggle on={guides.grid} onChange={(v) => setGuides({ ...guides, grid: v })} title="Grid (⇧G)">Grid</Toggle>
              {story && <Toggle on={guides.safe} onChange={(v) => setGuides({ ...guides, safe: v })} title="Safe area (⇧S)">Safe area</Toggle>}
            </>
          )}
        </div>
        <div className="exports">
          {moving && (
            <button type="button" className="btn" onClick={record} disabled={recording}>
              {recording ? 'Recording' : `Video ${secs(Number(loops) * seconds)} s`}
            </button>
          )}
          <button type="button" className="btn" onClick={() => exportAs('copy')}>Copy SVG</button>
          <button type="button" className="btn" onClick={() => exportAs('png')}>PNG</button>
          <button type="button" className="btn" onClick={() => exportAs('pdf')}>PDF</button>
          <button type="button" className="btn primary" onClick={() => exportAs('svg')}>Export SVG</button>
        </div>
      </header>

      <aside className="panel left">
        <Panel open={leftOpen} setOpen={setLeftOpen}>
        <div className="tabs" role="tablist" aria-label="Layer to edit">
          <button type="button" role="tab" aria-selected={tab === 'type'} className={`chip ${tab === 'type' ? 'on' : ''}`} onClick={() => {
            setTab('type')
            setLeftOpen('Text')
          }}>Type</button>
          <button type="button" role="tab" aria-selected={tab === 'image'} className={`chip ${tab === 'image' ? 'on' : ''}`} onClick={() => {
            setTab('image')
            setLeftOpen('Photo')
          }}>Image</button>
        </div>

        {tab === 'image' && (
          <>
            <Section title="Photo" summary={photo ? (photo.video ? `Video · ${secs(trim.end - trim.start)} s` : 'Photo') : 'None'}>
              {photo ? (
                <div className="photo-row">
                  <span className="photo-name" title={photo.name}>
                    {photo.name}
                    {photo.video && <small className="photo-kind">Video · {secs(photo.duration ?? 0)} s</small>}
                  </span>
                  <button type="button" className="btn" onClick={() => setPhoto(null)}>Remove</button>
                </div>
              ) : null}
              <label
                className={`drop ${dropping ? 'over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDropping(true)
                }}
                onDragLeave={() => setDropping(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDropping(false)
                  addPhoto(e.dataTransfer.files[0])
                }}
              >
                <input
                  type="file"
                  accept="image/*,video/*,.mov,.mp4,.m4v,.webm"
                  onChange={(e) => {
                    addPhoto(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
                <span>{photo ? 'Replace photo or video' : 'Choose a photo or video, or drop one here'}</span>
                <small>It stays in this browser and is not uploaded</small>
              </label>
              {photo?.video && (
                <>
                  <Slider
                    label="Start"
                    value={trim.start}
                    min={0}
                    max={photo.duration ?? 0}
                    step={0.1}
                    reset={0}
                    format={(v) => `${v.toFixed(1)} s`}
                    onChange={(v) => setTrim({ start: Math.min(v, trim.end - 0.5), end: trim.end })}
                  />
                  <Slider
                    label="End"
                    note={`The loop is ${secs(clip)} s`}
                    value={trim.end}
                    min={0}
                    max={photo.duration ?? 0}
                    step={0.1}
                    reset={photo.duration ?? 0}
                    format={(v) => `${v.toFixed(1)} s`}
                    onChange={(v) => setTrim({ start: trim.start, end: Math.max(v, trim.start + 0.5) })}
                  />
                  <label className="check">
                    <input type="checkbox" checked={keepSound} onChange={(e) => setKeepSound(e.target.checked)} />
                    Keep the sound in exported video
                  </label>
                </>
              )}
            </Section>

            {photo && (
              <Section title="Crop" summary={`${Math.round(place.zoom * 100)}%`} action={<Reset onClick={() => setPlace({ zoom: 1, x: 0, y: 0 })} />}>
                <Slider label="Zoom" value={place.zoom} min={1} max={3} step={0.01} reset={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setPlace({ ...place, zoom: v })} />
                <Slider label="Left to right" value={place.x} min={-1} max={1} step={0.01} reset={0} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => setPlace({ ...place, x: v })} />
                <Slider label="Top to bottom" value={place.y} min={-1} max={1} step={0.01} reset={0} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => setPlace({ ...place, y: v })} />
              </Section>
            )}

            {(
              <Section
                title="Layout"
                summary={LAYOUTS.find((l) => l.id === crop)?.label}
                action={
                  <Reset
                    onClick={() => {
                      setCrop('full')
                      setBlob({ seed: 1, size: 0.9 })
                      setWindowShape({ style: 'roam', size: 0.5, seed: 1, round: 0.5 })
                      setHideType(true)
                      setShapeMotion('follow')
                      setShapeSpeed(1)
                    }}
                  />
                }
              >
                <div className="options" role="radiogroup" aria-label="Layout">
                  {LAYOUTS.filter((l) => photo || l.id !== 'letters').map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      role="radio"
                      aria-checked={crop === l.id}
                      className={`option ${crop === l.id ? 'on' : ''}`}
                      onClick={() => {
                        setCrop(l.id)
                        if (l.id === 'window') setPlaying(true)
                      }}
                    >
                      <b>{photo ? l.label : l.plain}</b>
                      <span>{photo ? l.photo : l.colour}</span>
                    </button>
                  ))}
                </div>
                {!photo && (crop === 'blob' || crop === 'window') && (
                  <div className="field">
                    <span className="field-label">Colour</span>
                    <Swatches value={shapeFill} onChange={setShapeFill} label="Shape colour" />
                  </div>
                )}
                {crop === 'window' && (
                  <>
                    <select className="select" aria-label="Window style" value={windowShape.style} onChange={(e) => setWindowShape({ ...windowShape, style: e.target.value as WindowStyle })}>
                      {WINDOW_STYLES.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.label}
                        </option>
                      ))}
                    </select>
                    <p className="motion-hint">{WINDOW_STYLES.find((w) => w.id === windowShape.style)?.hint}</p>
                    <Slider label="Roundness" hint="From lively tips and droplets to a few smooth pebbles" value={windowShape.round} reset={0.5} onChange={(v) => setWindowShape({ ...windowShape, round: v })} />
                    {windowShape.style === 'islands' && (
                      <Slider label="Spread" hint="1 scatters the islands over the board; lower gathers them into one group that drifts around together" value={windowShape.spread ?? 1} reset={1} onChange={(v) => setWindowShape({ ...windowShape, spread: v })} />
                    )}
                    <Slider label={photo ? 'Amount of photo' : 'Amount of colour'} value={windowShape.size} reset={0.5} onChange={(v) => setWindowShape({ ...windowShape, size: v })} />
                    <Slider
                      label="Speed"
                      note={
                        Math.abs(timing.speed - shapeSpeed) > 0.005
                          ? `Runs at ${timing.speed.toFixed(2)}× the type's pace so the loop closes`
                          : `One loop is ${seconds.toFixed(1)} s`
                      }
                      value={shapeSpeed}
                      min={0.25}
                      max={3}
                      step={0.05}
                      reset={1}
                      format={(v) => `${v.toFixed(2)}×`}
                      onChange={setShapeSpeed}
                    />
                    <div className="field">
                      <span className="field-label">Form {windowShape.seed}</span>
                      <button type="button" className="btn" onClick={() => setWindowShape({ ...windowShape, seed: windowShape.seed + 1 })}>New form</button>
                    </div>
                    <label className="check">
                      <input type="checkbox" checked={hideType} onChange={(e) => setHideType(e.target.checked)} />
                      The moving shape hides the type
                    </label>
                  </>
                )}
                {crop === 'blob' && (
                  <>
                    <Slider label="Size" value={blob.size} min={0.3} max={2.5} step={0.01} reset={0.9} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setBlob({ ...blob, size: v })} />
                    <div className="field">
                      <span className="field-label">Form {blob.seed}</span>
                      <button type="button" className="btn" onClick={() => setBlob({ ...blob, seed: blob.seed + 1 })}>New form</button>
                    </div>
                    <div className="field-label">Shape motion</div>
                    <div className="chips">
                      <button type="button" className={`chip ${shapeMotion === 'follow' ? 'on' : ''}`} onClick={() => setShapeMotion('follow')}>With type</button>
                      {MOTIONS.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={`chip ${shapeMotion === m.id ? 'on' : ''}`}
                          onClick={() => {
                            setShapeMotion(m.id)
                            setPlaying(true)
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {shapeMove !== 'off' && (
                      <Slider
                        label="Speed"
                        note={
                          Math.abs(timing.speed - shapeSpeed) > 0.005
                            ? `Runs at ${timing.speed.toFixed(2)}× the type's pace so the loop closes`
                            : motion !== 'off'
                              ? `Measured against the type's pace. One loop is ${seconds.toFixed(1)} s`
                              : `One loop is ${seconds.toFixed(1)} s`
                        }
                        value={shapeSpeed}
                        min={0.25}
                        max={3}
                        step={0.05}
                        reset={1}
                        format={(v) => `${v.toFixed(2)}×`}
                        onChange={setShapeSpeed}
                      />
                    )}
                    <p className="motion-hint">
                      {shapeMotion === 'follow'
                        ? motion === 'off'
                          ? 'The shape does whatever the type does. The type is still, so it is too'
                          : `Moving with the type: ${MOTIONS.find((m) => m.id === motion)?.label}`
                        : 'The shape moves on its own; the photo inside stays still'}
                    </p>
                  </>
                )}
                {crop === 'letters' && <p className="motion-hint">The photo shows through the type. Use big, heavy type so it reads.</p>}
              </Section>
            )}

            {photo && fx && crop === 'full' && look === 'map' && (
              <Section
                title="Photo effect"
                summary={PHOTO_EFFECTS.find((e) => e.id === effect)?.label}
                action={
                  <Reset
                    onClick={() => {
                      setEffect('off')
                      setFxTune({})
                      setFxSeed(1)
                      setSwapTo(RAMPS[1].id)
                    }}
                  />
                }
              >
                <select
                  className="select"
                  aria-label="Photo effect"
                  value={effect}
                  onChange={(e) => {
                    setEffect(e.target.value as PhotoEffect)
                    setPlaying(true)
                  }}
                >
                  {PHOTO_EFFECTS.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
                <p className="motion-hint">{PHOTO_EFFECTS.find((e) => e.id === effect)?.hint}</p>
                {effect !== 'off' && (
                  <>
                    <Slider
                      label="Speed"
                      note={
                        Math.abs(fxActual - tune.speed) > 0.02
                          ? `Runs at ${fxActual.toFixed(2)}× so it closes the loop with the ${motion !== 'off' ? 'type' : 'shape'}`
                          : `One pass takes ${(FX_SECONDS / fxActual).toFixed(1)} s`
                      }
                      value={tune.speed}
                      min={0.25}
                      max={3}
                      step={0.05}
                      reset={1}
                      format={(v) => `${v.toFixed(2)}×`}
                      onChange={(v) => setTune({ speed: v })}
                    />
                    <Slider label="Strength" hint="How far the effect goes at its peak" value={tune.strength} reset={1} onChange={(v) => setTune({ strength: v })} />
                  </>
                )}
                {effect === 'rampSwap' && (
                  <div className="field">
                    <span className="field-label">Swap to</span>
                    <Segmented label="Second ramp" value={swapTo} onChange={setSwapTo} options={RAMPS.map((r) => ({ id: r.id, label: r.label }))} />
                  </div>
                )}
                {(effect === 'blurBleed' || effect === 'clayBleed') && (
                  <div className="field">
                    <span className="field-label">Spots {fxSeed}</span>
                    <button type="button" className="btn" onClick={() => setFxSeed(fxSeed + 1)}>New spots</button>
                  </div>
                )}
              </Section>
            )}

            {photo && (
              <Section
                title="Colour"
                summary={look === 'cut' ? 'Clay cut' : gmap.enabled ? (RAMPS.find((r) => r.shadow === gmap.shadow && r.highlight === gmap.highlight)?.label ?? 'Custom') : 'Off'}
                action={
                  <span className="actions">
                    {look === 'map' && (
                      <button type="button" className="link" onClick={() => setGmap({ ...gmap, enabled: !gmap.enabled })}>
                        {gmap.enabled ? 'On' : 'Off'}
                      </button>
                    )}
                    <Reset
                      onClick={() => {
                        setGmap({ enabled: true, shadow: RAMPS[0].shadow, highlight: RAMPS[0].highlight, contrast: 0, brightness: 0 })
                        setCut(CLAY_CUT)
                      }}
                    />
                  </span>
                }
              >
                {fx && (
                  <Segmented
                    label="Look"
                    value={look}
                    onChange={setLook}
                    options={[
                      { id: 'map', label: 'Gradient map', title: 'The photo in two colours, with every tone between them' },
                      { id: 'cut', label: 'Clay cut', title: 'The photo cut into two flat colours with soft clay edges' },
                    ]}
                  />
                )}
                <div className="chips">
                  {RAMPS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`chip ${gmap.shadow === r.shadow && gmap.highlight === r.highlight ? 'on' : ''}`}
                      onClick={() => setGmap({ ...gmap, enabled: true, shadow: r.shadow, highlight: r.highlight })}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {look === 'map' ? (
                  <>
                    <div className="ramp" style={{ background: `linear-gradient(to right, ${gmap.shadow}, ${gmap.highlight})` }} aria-hidden="true" />
                    <div className="field">
                      <span className="field-label">Shadows</span>
                      <Swatches value={gmap.shadow} onChange={(v) => setGmap({ ...gmap, enabled: true, shadow: v })} label="Shadow colour" />
                    </div>
                    <div className="field">
                      <span className="field-label">Highlights</span>
                      <Swatches value={gmap.highlight} onChange={(v) => setGmap({ ...gmap, enabled: true, highlight: v })} label="Highlight colour" />
                    </div>
                    <Slider label="Contrast" value={gmap.contrast} min={-1} max={1} step={0.01} reset={0} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => setGmap({ ...gmap, contrast: v })} />
                    <Slider label="Brightness" value={gmap.brightness} min={-1} max={1} step={0.01} reset={0} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => setGmap({ ...gmap, brightness: v })} />
                  </>
                ) : (
                  <>
                    <div className="field">
                      <span className="field-label">Ink</span>
                      <Swatches value={gmap.shadow} onChange={(v) => setGmap({ ...gmap, shadow: v })} label="Ink colour" />
                    </div>
                    <div className="field">
                      <span className="field-label">Ground</span>
                      <Swatches value={gmap.highlight} onChange={(v) => setGmap({ ...gmap, highlight: v })} label="Ground colour" />
                    </div>
                    <div className="field">
                      <span className="field-label">Ink on</span>
                      <Segmented
                        label="Ink on"
                        value={cut.light ? 'light' : 'dark'}
                        onChange={(v) => setCut({ ...cut, light: v === 'light' })}
                        options={[
                          { id: 'dark', label: 'Darks' },
                          { id: 'light', label: 'Lights' },
                        ]}
                      />
                    </div>
                    <Slider label="Softness" hint="How rounded the shapes are" value={cut.softness} reset={CLAY_CUT.softness} onChange={(v) => setCut({ ...cut, softness: v })} />
                    <Slider label="Cut" hint="Higher leaves less ink" value={cut.level} min={0.15} max={0.85} reset={CLAY_CUT.level} onChange={(v) => setCut({ ...cut, level: v })} />
                    <Slider label="Detail" hint="0 is one abstract mass; higher keeps faces and features recognisable" value={cut.detail} reset={CLAY_CUT.detail} onChange={(v) => setCut({ ...cut, detail: v })} />
                    <button
                      type="button"
                      className="btn"
                      title={photo.video ? 'Picks the settings for the frame showing now' : 'Picks the settings for this photo'}
                      onClick={() => {
                        const v = photo.video
                        setCut(v ? autoClayCut(v, v.videoWidth, v.videoHeight) : autoClayCut(photo.canvas, photo.canvas.width, photo.canvas.height))
                      }}
                    >
                      Auto
                    </button>
                  </>
                )}
              </Section>
            )}
          </>
        )}

        {tab === 'type' && (
        <>
        <Section title="Templates" summary={saved.length ? `${TEMPLATES.length + saved.length} templates` : TEMPLATES[0].label}>
          <div className="chips">
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="chip" title={t.title} onClick={() => applyTemplate(t)}>
                {t.label}
              </button>
            ))}
            {saved.map((t) => (
              <span key={t.id} className="chip saved">
                <button type="button" className="saved-use" title="Use this template; your photo or video stays" onClick={() => useSaved(t)}>
                  {t.name}
                </button>
                <button type="button" className="saved-remove" aria-label={`Remove ${t.name}`} title="Remove from this browser" onClick={() => setSaved(saved.filter((x) => x.id !== t.id))}>
                  ×
                </button>
              </span>
            ))}
          </div>
          {naming !== null ? (
            <form
              className="name-row"
              onSubmit={(e) => {
                e.preventDefault()
                saveTemplate(naming)
              }}
            >
              <input className="name-input" autoFocus value={naming} placeholder="Name" aria-label="Template name" onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} />
              <button type="submit" className="btn">Save</button>
            </form>
          ) : (
            <button type="button" className="btn" title="Saves everything on the board except the photo or video" onClick={() => setNaming('')}>
              Save as template
            </button>
          )}
          <div className="actions">
            {saved.length > 0 && (
              <button type="button" className="link" onClick={exportTemplates} title="One file with all your templates, to send to the team">
                Download for the team
              </button>
            )}
            <label className="link file-link" title="Add templates from a file someone sent you">
              <input type="file" accept="application/json,.json" onChange={(e) => importTemplates(e.target.files?.[0])} />
              Add from file
            </label>
          </div>
          <p className="motion-hint">Templates keep the text, colours, layout and motion; the photo or video stays yours. Saved in this browser only, so share them as a file.</p>
        </Section>

        <Section
          title="Text"
          summary={fixed.w ? `${layers.length} ${layers.length === 1 ? 'text' : 'texts'}` : layers[0].text.split('\n')[0]}
        >
          {fixed.w > 0 ? (
            <div className="layers" role="listbox" aria-multiselectable="true" aria-label="Text layers" title="Shift or ⌘ click to select more than one">
              {layers.map((l) => (
                <button key={l.id} type="button" role="option" aria-selected={isChosen(l.id)} className={`layer ${isChosen(l.id) ? 'on' : ''}`} onClick={(e) => pick(l.id, e.shiftKey || e.metaKey || e.ctrlKey)}>
                  <span className="layer-name">{l.text.split('\n')[0].trim() || 'Empty'}</span>
                  <span className="layer-kind">{l.style === 'clay' ? 'Clay' : 'Plain'}</span>
                </button>
              ))}
              <div className="list-bar">
                <IconButton label="Add text (T)" onClick={addLayer}>
                  <Plus />
                </IconButton>
                <IconButton label={many ? 'Delete the selected texts (⌫)' : 'Delete this text (⌫)'} onClick={deleteLayer} disabled={none || layers.length < 2 || chosen.length >= layers.length}>
                  <Minus />
                </IconButton>
                <button type="button" className="link" title="⌘A" onClick={() => setSelection(layers.map((l) => l.id))} disabled={chosen.length === layers.length}>
                  Select All
                </button>
              </div>
            </div>
          ) : (
            layers.length > 1 && <p className="motion-hint">Fit shows only the first text. Pick a board size to see all {layers.length}.</p>
          )}
          {none ? (
            <p className="motion-hint">Pick a text to edit it, here or on the board. Esc or a click on the empty board lets go again.</p>
          ) : many ? (
            <p className="motion-hint">{chosen.length} texts selected. Style, size, alignment and colour change for all of them.</p>
          ) : (
          <textarea
            className="text-input"
            value={layer.text}
            spellCheck={false}
            rows={3}
            aria-label="Text"
            onChange={(e) => setL('text', e.target.value)}
          />
          )}
          {!fixed.w && <p className="motion-hint">Pick a board size to add more text</p>}
          {!none && (
          <>
          <div className="field">
            <span className="field-label">Style</span>
            <Segmented
              label="Type style"
              value={layer.style}
              onChange={(v) => setL('style', v)}
              options={[
                { id: 'clay', label: 'Clay' },
                { id: 'plain', label: 'Plain' },
              ]}
            />
          </div>
          {layer.style === 'plain' && (
            <Slider label="Line height" hint="Open it up for longer text" value={layer.lineHeight} min={0.8} max={1.2} step={0.05} reset={PLAIN_TYPE.lineHeight} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setL('lineHeight', v)} />
          )}
          <div className="field">
            <span className="field-label">Align</span>
            <Segmented
              label="Alignment"
              value={layer.align}
              onChange={(v) => setL('align', v)}
              options={[
                { id: 'left', label: 'Left' },
                { id: 'center', label: 'Center' },
                { id: 'right', label: 'Right' },
              ]}
            />
          </div>
          {fixed.w > 0 && !many && (
            <div className="field">
              <span className="field-label">Place</span>
              <div className="place-groups">
                <div className="segmented" role="group" aria-label="Place across the board">
                  <button type="button" title="Left margin" aria-label="Left margin" onClick={() => placeLayer('left')}><AlignLeft /></button>
                  <button type="button" title="Middle" aria-label="Middle, across" onClick={() => placeLayer('center')}><AlignCentre /></button>
                  <button type="button" title="Right margin" aria-label="Right margin" onClick={() => placeLayer('right')}><AlignRight /></button>
                </div>
                <div className="segmented" role="group" aria-label="Place up and down the board">
                  <button type="button" title="Top margin" aria-label="Top margin" onClick={() => placeLayer('top')}><AlignTop /></button>
                  <button type="button" title="Middle" aria-label="Middle, up and down" onClick={() => placeLayer('middle')}><AlignMiddle /></button>
                  <button type="button" title="Bottom margin" aria-label="Bottom margin" onClick={() => placeLayer('bottom')}><AlignBottom /></button>
                </div>
              </div>
            </div>
          )}
          <Slider label="Size" hint="In steps of 8 px" value={layer.fontSize} min={8} max={600} step={8} reset={160} format={(v) => `${v} px`} onChange={(v) => setL('fontSize', v)} />
          <div className="field">
            <span className="field-label">Colour</span>
            <Swatches value={layer.fill} onChange={(v) => setL('fill', v)} label="Type colour" />
          </div>
          </>
          )}
        </Section>
        </>
        )}

        <Section title="Canvas" summary={BOARDS.find((b) => b.id === type.board)?.label}>
          <div className="field">
            <span className="field-label">Board</span>
            <Segmented label="Board size" value={type.board} onChange={(v) => setT('board', v)} options={BOARDS.map((b) => ({ id: b.id, label: b.label, title: b.title }))} />
          </div>
          <div className="field">
            <span className="field-label">Ground</span>
            <Swatches value={background} onChange={setBackground} label="Background colour" />
          </div>
          <label className="check">
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
            Export without background
          </label>
        </Section>

        {fixed.w > 0 && (
          <Section title="Grid" summary={`${grid.columns} × ${grid.rows}`} action={<Reset onClick={() => setGrid(DEFAULT_GRID)} />}>
            <Slider label="Columns" value={grid.columns} min={1} max={12} step={1} reset={DEFAULT_GRID.columns} format={(v) => `${v}`} onChange={(v) => setGrid({ ...grid, columns: v })} />
            <Slider label="Side margin" value={grid.side} min={0} max={240} step={1} reset={DEFAULT_GRID.side} format={(v) => `${v} px`} onChange={(v) => setGrid({ ...grid, side: v })} />
            <Slider label="Rows" value={grid.rows} min={1} max={16} step={1} reset={DEFAULT_GRID.rows} format={(v) => `${v}`} onChange={(v) => setGrid({ ...grid, rows: v })} />
            <Slider label="Top and bottom margin" value={grid.top} min={0} max={400} step={1} reset={DEFAULT_GRID.top} format={(v) => `${v} px`} onChange={(v) => setGrid({ ...grid, top: v })} />
            <Slider label="Gutter" value={grid.gutter} min={0} max={80} step={1} reset={DEFAULT_GRID.gutter} format={(v) => `${v} px`} onChange={(v) => setGrid({ ...grid, gutter: v })} />
          </Section>
        )}
        </Panel>
      </aside>

      <main className="center">
        {error ? (
          <div className="empty">Could not load the brand font. {error}</div>
        ) : out ? (
          <Stage
            paints={out.paints}
            textShown={!lettersOnly}
            loops={out.loops}
            source={out.source}
            frame={out.frame}
            background={background}
            backdrop={backdrop}
            typeClip={typeHide}
            view={view}
            boxes={out.boxes}
            selected={fixed.w ? chosen.map((l) => l.id) : []}
            editable={fixed.w > 0 && !recording}
            onSelect={pick}
            onClear={clear}
            onMove={moveLayer}
            snaps={snaps}
            grid={guides.grid ? lines : null}
            safe={guides.safe && story ? SAFE_FRAMES : null}
          />
        ) : (
          <div className="empty">Loading Instrument Sans</div>
        )}
        <footer className="status">
          <span>{size} px</span>
          {out?.overflow && <span className="warn">Some text runs past the board</span>}
          <span>{out?.nodes ?? 0} points</span>
          <span>{out ? out.ms.toFixed(0) : 0} ms</span>
          {note && <span className="note" role="status">{note}</span>}
        </footer>
      </main>

      <aside className="panel right">
        <Panel open={rightOpen} setOpen={setRightOpen}>
        {!hasClay && <p className="panel-note">Plain type is set as the font draws it, so the clay controls and type motion are off. Set a text's Style to Clay to use them.</p>}
        <div className={!hasClay ? 'muted' : undefined}>
        <Section
          title="Clay"
          summary={PRESETS.find((pr) => pr.id === activePreset)?.label ?? 'Custom'}
          action={
            // The seed only picks which noise pattern is used, so it is only offered while noise is on.
            <span className="actions">
              {params.noise > 0 && (
                <button type="button" className="link" onClick={() => setP('seed', params.seed + 1)}>
                  Noise pattern {params.seed} · New
                </button>
              )}
              <Reset onClick={() => setParams({ ...PRESETS[0].params, seed: 1 })} />
            </span>
          }
        >
          <div className="chips">
            {PRESETS.map((pr) => (
              <button key={pr.id} type="button" className={`chip ${activePreset === pr.id ? 'on' : ''}`} onClick={() => setParams((p) => ({ ...pr.params, seed: p.seed }))}>
                {pr.label}
              </button>
            ))}
          </div>
          {ORGANIC.map((o) => (
            <Slider key={o.key} label={o.label} hint={o.hint} value={params[o.key]} reset={PRESETS[0].params[o.key]} onChange={(v) => setP(o.key, v)} />
          ))}
        </Section>

        <Section
          title="Motion"
          summary={MOTIONS.find((m) => m.id === motion)?.label}
          action={
            <Reset
              onClick={() => {
                setMotion('off')
                setTypeSpeed(1)
                setRestBy({})
              }}
            />
          }
        >
          <div className="chips">
            {MOTIONS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`chip ${motion === m.id ? 'on' : ''}`}
                onClick={() => {
                  phaseRef.current = 0
                  setPhase(0)
                  setMotion(m.id)
                  setPlaying(true)
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="motion-hint">{MOTIONS.find((m) => m.id === motion)?.hint}</p>
          {motion !== 'off' && (
            <Slider
              label="Speed"
              note={`One ${MOTIONS.find((m) => m.id === motion)?.label.toLowerCase()} takes ${(base / typeSpeed).toFixed(1)} s`}
              value={typeSpeed}
              min={0.25}
              max={3}
              step={0.05}
              reset={1}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={setTypeSpeed}
            />
          )}
          {motion !== 'off' && (
            <Slider label="Resting effect" hint={REST[motion].hint} value={rest} reset={REST[motion].start} onChange={(v) => setRestBy((all) => ({ ...all, [motion]: v }))} />
          )}
        </Section>
        </div>
        {moving && (
          <Section title="Playback" pinned>
          {moving && (
            <div className="transport">
              <button type="button" className="btn" title="Space" onClick={() => setPlaying(!playing)}>
                {playing ? 'Pause' : 'Play'}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={shownPhase}
                aria-label="Scrub"
                style={{ '--fill': `${shownPhase * 100}%` } as CSSProperties}
                onChange={(e) => {
                  setPlaying(false)
                  phaseRef.current = Number(e.target.value)
                  setPhase(phaseRef.current)
                }}
              />
            </div>
          )}
          {moving && (
            <div className="field">
              <span className="field-label">Video length</span>
              <Segmented
                label="Loops in the exported video"
                value={loops}
                onChange={setLoops}
                options={(['1', '2', '3'] as const).map((n) => ({ id: n, label: `${secs(Number(n) * seconds)} s`, title: `${n} loop${n === '1' ? '' : 's'}` }))}
              />
            </div>
          )}
          </Section>
        )}
        </Panel>
      </aside>
    </div>
  )
}

interface SavedTemplate<D> {
  id: string
  name: string
  design: D
}
const TEMPLATE_KEY = 'ac-studio-templates'
function loadTemplates<D>(): SavedTemplate<D>[] {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
function storeTemplates(list: SavedTemplate<unknown>[]) {
  try {
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(list))
  } catch {
    // Private windows can refuse storage; the templates then last until the page closes.
  }
}

/** Seconds for a label: whole when it is whole, one decimal otherwise. */
const secs = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1))

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

function Swatches({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.hex}
          aria-label={c.label}
          title={c.label}
          className={`swatch ${value === c.hex ? 'on' : ''}`}
          style={{ background: c.hex }}
          onClick={() => onChange(c.hex)}
        />
      ))}
      <label className="swatch custom" title="Custom colour">
        <input type="color" value={value} aria-label={`${label}, custom`} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      </label>
    </div>
  )
}
