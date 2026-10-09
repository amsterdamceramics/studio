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
  type PhotoEffect,
  type TypeClip,
  type WindowShape,
  type WindowStyle,
  type Placement,
  type Motion,
  type OrganicParams,
} from './engine'
import { COLORS, PRESETS, RAMPS } from './presets'
import { Section, Segmented, Slider, Toggle } from './ui/controls'
import { Stage, type View } from './ui/Stage'

const BOARDS = [
  { id: 'fit', label: 'Fit', title: 'Hug the type', w: 0, h: 0 },
  { id: 'story', label: '9:16', title: 'Story, 1080 × 1920', w: 1080, h: 1920 },
  { id: 'portrait', label: '4:5', title: 'Portrait post, 1080 × 1350', w: 1080, h: 1350 },
  { id: 'square', label: '1:1', title: 'Square post, 1080 × 1080', w: 1080, h: 1080 },
] as const
type BoardId = (typeof BOARDS)[number]['id']
type Place = 'top' | 'middle' | 'bottom'

interface Type {
  text: string
  fontSize: number
  align: Align
  padding: number
  /** Clay runs the type through the engine; plain sets the font as it is. */
  style: 'clay' | 'plain'
  /** Leading for plain type only; clay type is fixed. */
  lineHeight: number
  board: BoardId
  place: Place
}

interface Output {
  loops: BezierLoop[]
  source: BezierLoop[]
  frame: Frame
  nodes: number
  ms: number
  /** True when the type runs past the board's margins. */
  overflow: boolean
  /** Loop phase this frame was generated at. */
  phase: number
}

const DEFAULT_TYPE: Type = {
  text: 'amsterdam\nceramics',
  fontSize: 160,
  align: 'left',
  padding: 0.35,
  style: 'clay',
  lineHeight: PLAIN_TYPE.lineHeight,
  board: 'fit',
  place: 'middle',
}

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

/** `phase` is the position in the whole loop; the type runs `cycles` times within it. */
function render(ts: TypeSetter, type: Type, params: OrganicParams, motion: Motion, phase: number, rest: number, cycles = 1): Output {
  const setting = type.style === 'plain' ? { tracking: PLAIN_TYPE.tracking, lineHeight: type.lineHeight } : BRAND_TYPE
  const layout = ts.layout({ text: type.text, align: type.align, textCase: 'none', ...setting })
  const fr = frameAt(motion, (phase * cycles) % 1, params, rest)
  const res = type.style === 'plain' ? { loops: layout.source, nodes: layout.source.reduce((n, l) => n + l.segs.length, 0), ms: 0 } : organic(layout.pieces, layout.source, fr.params, fr.mod(layout.box))
  const pad = type.padding * EM
  const scale = type.fontSize / EM
  const board = BOARDS.find((b) => b.id === type.board)!
  const box = layout.box
  let frame: Frame = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2, scale }
  let overflow = false
  if (board.w) {
    // A fixed board: the type keeps its pixel size and is placed inside the margins.
    const w = board.w / scale
    const h = board.h / scale
    const x = type.align === 'left' ? box.x - pad : type.align === 'right' ? box.x + box.w + pad - w : box.x + box.w / 2 - w / 2
    const y = type.place === 'top' ? box.y - pad : type.place === 'bottom' ? box.y + box.h + pad - h : box.y + box.h / 2 - h / 2
    frame = { x, y, w, h, scale }
    overflow = box.w + pad * 2 > w + 1 || box.h + pad * 2 > h + 1
  }
  return { loops: res.loops, source: layout.source, frame, nodes: res.nodes, ms: res.ms, phase, overflow }
}

export default function App() {
  const [ts, setTs] = useState<TypeSetter | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<Type>(DEFAULT_TYPE)
  const [params, setParams] = useState<OrganicParams>({ ...PRESETS[0].params, seed: 1 })
  const [fill, setFill] = useState('#000000')
  const [background, setBackground] = useState('#FFFFFF')
  const [transparent, setTransparent] = useState(false)
  const [view, setView] = useState<View>({ outline: false, points: false, ghost: false, actualSize: false })
  const [motionSet, setMotion] = useState<Motion>('off')
  // Plain type has no clay to move, so its motion is simply off while that style is chosen.
  const motion: Motion = type.style === 'plain' ? 'off' : motionSet
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
  const [photo, setPhoto] = useState<{ canvas: HTMLCanvasElement; name: string } | null>(null)
  const [gmap, setGmap] = useState<GradientMap>({ enabled: true, shadow: RAMPS[0].shadow, highlight: RAMPS[0].highlight, contrast: 0, brightness: 0 })
  const [place, setPlace] = useState<Placement>({ zoom: 1, x: 0, y: 0 })
  const [dropping, setDropping] = useState(false)
  const [crop, setCrop] = useState<'full' | 'blob' | 'letters' | 'window'>('full')
  const [windowShape, setWindowShape] = useState<WindowShape>({ style: 'roam', size: 0.5, seed: 1 })
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
  const liveEffect: PhotoEffect = crop === 'full' ? effect : 'off'
  const fxOn = !!photo && !!fx && liveEffect !== 'off'
  const moving = motion !== 'off' || shapeMove !== 'off' || fxOn || crop === 'window'
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
  const { typeCycles, shapeCycles, seconds } = timing
  // Alongside type or shape motion the effect has to finish on a whole number of cycles per loop,
  // so it takes the nearest speed that does.
  const fxAlone = motion === 'off' && !shapeOn
  const fxCycles = fxAlone ? 1 : Math.max(1, Math.round((seconds * tune.speed) / FX_SECONDS))
  const fxActual = fxAlone ? tune.speed : (fxCycles * FX_SECONDS) / seconds

  useEffect(() => {
    if (!ts || animating || recording) return
    const raf = requestAnimationFrame(() => setOut(render(ts, type, params, motion, moving ? phase : 0, rest, typeCycles)))
    return () => cancelAnimationFrame(raf)
  }, [ts, type, params, motion, phase, animating, recording, rest, moving, typeCycles])

  useEffect(() => {
    if (!ts || !animating) return
    let raf = 0
    const origin = performance.now() - phaseRef.current * seconds * 1000
    const loop = (now: number) => {
      const p = (((now - origin) / 1000 / seconds) % 1 + 1) % 1
      phaseRef.current = p
      setOut(render(ts, type, params, motion, p, rest, typeCycles))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      setPhase(phaseRef.current)
    }
  }, [ts, type, params, motion, animating, seconds, rest, typeCycles])

  // Undo. Everything that makes up the artwork is gathered into one snapshot; a change is committed
  // to history once it has settled for a moment, so dragging a slider is one step, not hundreds.
  const snap = { type, params, fill, background, transparent, motion: motionSet, typeSpeed, restBy, photo, gmap, place, crop, blob, windowShape, hideType, shapeFill, shapeMotion, shapeSpeed, effect, fxTune, fxSeed, swapTo }
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
    // The renderer holds the photo's pixels, so it has to be handed the old photo before the frame draws.
    if (to.photo && to.photo !== photo) fx?.setPhoto(to.photo.canvas)
    h.committed = to
    setType(to.type)
    setParams(to.params)
    setFill(to.fill)
    setBackground(to.background)
    setTransparent(to.transparent)
    setMotion(to.motion)
    setTypeSpeed(to.typeSpeed)
    setRestBy(to.restBy)
    setPhoto(to.photo)
    setGmap(to.gmap)
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
    setSteps({ undo: h.undo.length, redo: h.redo.length })
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
  const keys = useRef({ undo, redo })
  useEffect(() => {
    keys.current = { undo, redo }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  const flash = useCallback((msg: string) => {
    setNote(msg)
    setTimeout(() => setNote(null), 1800)
  }, [])

  const name = useMemo(() => {
    const slug = type.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    return `ac-${slug || 'type'}`
  }, [type.text])

  const finalFrame = () => (ts ? render(ts, type, params, motion, moving ? phaseRef.current : 0, rest, typeCycles) : null)

  const bg = transparent ? null : background

  // Without WebGL the photo is treated once on the CPU and shown without effects.
  const treated = useMemo(() => (photo && !fx ? gradientMap(photo.canvas, gmap) : null), [photo, fx, gmap])

  /** The shape the photo is cropped to for a given frame, in engine space; null for the full board. */
  const windows = useRef(new WeakMap<Output, BezierLoop[]>())
  const cropFor = useCallback(
    (o: Output) => {
      if (crop === 'window') {
        // The photo and the type are both clipped by this outline, so it is worked out once per frame.
        let loops = windows.current.get(o)
        if (!loops) windows.current.set(o, (loops = clayWindow(o.frame, windowShape, (o.phase * shapeCycles) % 1)))
        return loops
      }
      if (crop === 'letters') return o.loops
      if (crop === 'blob') return clayFrame(o.frame, type.padding * EM, blob, shapeMove !== 'off' ? { motion: shapeMove, phase: (o.phase * shapeCycles) % 1, rest: shapeRest } : undefined)
      return null
    },
    [crop, blob, windowShape, shapeMove, shapeCycles, shapeRest, type.padding],
  )
  // A new outline has to be drawn when the window's settings change, even for the same frame.
  useEffect(() => {
    windows.current = new WeakMap()
  }, [windowShape, shapeCycles])
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
        ? (ctx: CanvasRenderingContext2D, cw: number, ch: number) =>
            ctx.drawImage(fx.render({ width: cw, height: ch, place, map: gmap, effect: liveEffect, phase: (o.phase * fxCycles) % 1, strength: tune.strength, swapTo: to, seed: fxSeed }), 0, 0, cw, ch)
        : treated
          ? coverPainter(treated, place)
          : null
      return composeBackdrop(w * density, h * density, w, background, paint, { clip: shape ? pathData(shape, o.frame) : undefined, bare })
    },
    [photo, fx, treated, gmap, liveEffect, swapTo, fxSeed, fxCycles, tune.strength, place, background, cropFor, crop, shapeFill],
  )
  const backdrop = useMemo(() => (out ? backdropFor(out, 1) : null), [out, backdropFor])
  const typeHide = useMemo(() => {
    const clip = out ? typeClipFor(out) : null
    return out && clip ? clipData(clip, out.frame) : null
  }, [out, typeClipFor])
  // Inside the letters, the photo is the fill.
  const ink = photo && crop === 'letters' ? null : fill

  const addPhoto = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return flash('That file is not an image')
    try {
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
      if (kind === 'svg') download(`${name}.svg`, svgBlob(o.loops, o.frame, ink, bg, image, hide, flat))
      if (kind === 'pdf') {
        const page = jpeg && picture ? { jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: picture.width, height: picture.height, clip: shape } : undefined
        download(`${name}.pdf`, pdfBlob(o.loops, o.frame, ink, bg, page, hide, flat))
      }
      if (kind === 'png') download(`${name}.png`, await pngBlob(o.loops, o.frame, ink, bg, 2, backdropFor(o, 2), hide))
      if (kind === 'copy') {
        await navigator.clipboard.writeText(svgDocument(o.loops, o.frame, ink, bg, image, hide, flat))
        flash('SVG copied')
        return
      }
      flash(`${kind.toUpperCase()} saved`)
    } catch (e) {
      flash(`Export failed: ${(e as Error).message}`)
    }
  }

  const record = async () => {
    if (!ts || !moving || recording) return
    const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
    if (!mime) return flash('This browser cannot record video')
    setRecording(true)
    const first = render(ts, type, params, motion, 0, rest, typeCycles)
    const canvas = document.createElement('canvas')
    // One video pixel per board pixel, so a 1080 × 1920 board is a 1080 × 1920 file. Video encoders need even sizes.
    canvas.width = Math.round((first.frame.w * first.frame.scale) / 2) * 2
    canvas.height = Math.round((first.frame.h * first.frame.scale) / 2) * 2
    const ctx = canvas.getContext('2d')!
    const density = canvas.width / Math.round(first.frame.w * first.frame.scale)
    const count = Number(loops)
    const rec = new MediaRecorder(canvas.captureStream(60), { mimeType: mime, videoBitsPerSecond: 12_000_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = () => {
      download(`${name}-${motion !== 'off' ? motion : windowOn ? windowShape.style : shapeMove !== 'off' ? shapeMove : effect}.${mime.includes('mp4') ? 'mp4' : 'webm'}`, new Blob(chunks, { type: mime }))
      setRecording(false)
      flash('Video saved')
    }
    const start = performance.now()
    const step = (now: number) => {
      const t = (now - start) / 1000 / seconds
      // The last frame sits just short of the seam, so the file itself also repeats cleanly.
      const o = render(ts, type, params, motion, t >= count ? 0.9999 : t % 1, rest, typeCycles)
      drawToCanvas(ctx, o.loops, o.frame, ink, background, backdropFor(o, density), typeClipFor(o))
      setOut(o)
      if (t < count) requestAnimationFrame(step)
      else rec.stop()
    }
    drawToCanvas(ctx, first.loops, first.frame, ink, background, backdropFor(first, density), typeClipFor(first))
    rec.start()
    requestAnimationFrame(step)
  }

  const setP = (key: keyof OrganicParams, v: number) => setParams((p) => ({ ...p, [key]: v }))
  const setT = <K extends keyof Type>(key: K, v: Type[K]) => setType((t) => ({ ...t, [key]: v }))
  const activePreset = PRESETS.find((pr) => ORGANIC.every((o) => Math.abs(pr.params[o.key] - params[o.key]) < 0.005))?.id

  const shownPhase = animating ? (out?.phase ?? 0) : phase
  const size = out ? `${Math.round(out.frame.w * out.frame.scale)} × ${Math.round(out.frame.h * out.frame.scale)}` : ''

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Amsterdam Ceramics</span>
          <span className="brand-tool">Studio</span>
        </div>
        <div className="view-toggles">
          <button type="button" className="toggle" onClick={undo} disabled={steps.undo === 0} title="Undo the last change (⌘Z)">Undo</button>
          <button type="button" className="toggle" onClick={redo} disabled={steps.redo === 0} title="Redo (⇧⌘Z)">Redo</button>
          <span className="divider" aria-hidden="true" />
          <Toggle on={view.outline} onChange={(v) => setView({ ...view, outline: v })}>Outline</Toggle>
          <Toggle on={view.points} onChange={(v) => setView({ ...view, points: v })}>Points</Toggle>
          <Toggle on={view.ghost} onChange={(v) => setView({ ...view, ghost: v })}>Original</Toggle>
          <Toggle on={view.actualSize} onChange={(v) => setView({ ...view, actualSize: v })}>100%</Toggle>
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
        <div className="tabs" role="tablist" aria-label="Layer to edit">
          <button type="button" role="tab" aria-selected={tab === 'type'} className={`chip ${tab === 'type' ? 'on' : ''}`} onClick={() => setTab('type')}>Type</button>
          <button type="button" role="tab" aria-selected={tab === 'image'} className={`chip ${tab === 'image' ? 'on' : ''}`} onClick={() => setTab('image')}>Image</button>
        </div>

        {tab === 'image' && (
          <>
            <Section title="Photo">
              {photo ? (
                <div className="photo-row">
                  <span className="photo-name" title={photo.name}>{photo.name}</span>
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
                  accept="image/*"
                  onChange={(e) => {
                    addPhoto(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
                <span>{photo ? 'Replace photo' : 'Choose a photo or drop one here'}</span>
                <small>It stays in this browser and is not uploaded</small>
              </label>
            </Section>

            {photo && (
              <Section title="Crop" action={<Reset onClick={() => setPlace({ zoom: 1, x: 0, y: 0 })} />}>
                <Slider label="Zoom" value={place.zoom} min={1} max={3} step={0.01} reset={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setPlace({ ...place, zoom: v })} />
                <Slider label="Left to right" value={place.x} min={-1} max={1} step={0.01} reset={0} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => setPlace({ ...place, x: v })} />
                <Slider label="Top to bottom" value={place.y} min={-1} max={1} step={0.01} reset={0} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => setPlace({ ...place, y: v })} />
              </Section>
            )}

            {(
              <Section
                title="Layout"
                action={
                  <Reset
                    onClick={() => {
                      setCrop('full')
                      setBlob({ seed: 1, size: 0.9 })
                      setWindowShape({ style: 'roam', size: 0.5, seed: 1 })
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
                    <Slider label={photo ? 'Amount of photo' : 'Amount of colour'} value={windowShape.size} reset={0.5} onChange={(v) => setWindowShape({ ...windowShape, size: v })} />
                    <Slider
                      label="Speed"
                      hint={
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
                        hint={
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

            {photo && fx && crop === 'full' && (
              <Section
                title="Photo effect"
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
                      hint={
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
                title="Gradient map"
                action={
                  <span className="actions">
                    <button type="button" className="link" onClick={() => setGmap({ ...gmap, enabled: !gmap.enabled })}>
                      {gmap.enabled ? 'On' : 'Off'}
                    </button>
                    <Reset onClick={() => setGmap({ enabled: true, shadow: RAMPS[0].shadow, highlight: RAMPS[0].highlight, contrast: 0, brightness: 0 })} />
                  </span>
                }
              >
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
              </Section>
            )}
          </>
        )}

        {tab === 'type' && (
        <>
        <Section title="Text">
          <textarea
            className="text-input"
            value={type.text}
            spellCheck={false}
            rows={4}
            aria-label="Text"
            onChange={(e) => setT('text', e.target.value)}
          />
        </Section>

        <Section title="Typography">
          <div className="field">
            <span className="field-label">Font</span>
            <span className="locked">Instrument Sans Bold</span>
          </div>
          <div className="field">
            <span className="field-label">Style</span>
            <Segmented
              label="Type style"
              value={type.style}
              onChange={(v) => setT('style', v)}
              options={[
                { id: 'clay', label: 'Clay' },
                { id: 'plain', label: 'Plain' },
              ]}
            />
          </div>
          {type.style === 'plain' && (
            <Slider label="Line height" hint="Open it up for longer text" value={type.lineHeight} min={0.8} max={1.2} step={0.05} reset={PLAIN_TYPE.lineHeight} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setT('lineHeight', v)} />
          )}
          <div className="field">
            <span className="field-label">Align</span>
            <Segmented
              label="Alignment"
              value={type.align}
              onChange={(v) => setT('align', v)}
              options={[
                { id: 'left', label: 'Left' },
                { id: 'center', label: 'Center' },
                { id: 'right', label: 'Right' },
              ]}
            />
          </div>
          {type.board !== 'fit' && (
            <div className="field">
              <span className="field-label">Position</span>
              <Segmented
                label="Vertical position"
                value={type.place}
                onChange={(v) => setT('place', v)}
                options={[
                  { id: 'top', label: 'Top' },
                  { id: 'middle', label: 'Middle' },
                  { id: 'bottom', label: 'Bottom' },
                ]}
              />
            </div>
          )}
          <Slider label="Size" value={type.fontSize} min={24} max={600} step={1} reset={160} format={(v) => `${v} px`} onChange={(v) => setT('fontSize', v)} />
          <div className="field">
            <span className="field-label">Colour</span>
            <Swatches value={fill} onChange={setFill} label="Type colour" />
          </div>
        </Section>
        </>
        )}

        <Section title="Canvas">
          <div className="field">
            <span className="field-label">Board</span>
            <Segmented label="Board size" value={type.board} onChange={(v) => setT('board', v)} options={BOARDS.map((b) => ({ id: b.id, label: b.label, title: b.title }))} />
          </div>
          <div className="field">
            <span className="field-label">Ground</span>
            <Swatches value={background} onChange={setBackground} label="Background colour" />
          </div>
          <Slider label="Margin" value={type.padding} min={0} max={1.5} step={0.05} reset={0.35} format={(v) => `${v.toFixed(2)} em`} onChange={(v) => setT('padding', v)} />
          <label className="check">
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
            Export without background
          </label>
        </Section>
      </aside>

      <main className="center">
        {error ? (
          <div className="empty">Could not load the brand font. {error}</div>
        ) : out ? (
          <Stage loops={out.loops} source={out.source} frame={out.frame} fill={ink} background={background} backdrop={backdrop} typeClip={typeHide} view={view} />
        ) : (
          <div className="empty">Loading Instrument Sans</div>
        )}
        <footer className="status">
          <span>{size} px</span>
          {out?.overflow && <span className="warn">Type runs past the margins: lower the size or the margin</span>}
          <span>{out?.nodes ?? 0} points</span>
          <span>{out ? out.ms.toFixed(0) : 0} ms</span>
          {note && <span className="note" role="status">{note}</span>}
        </footer>
      </main>

      <aside className="panel right">
        {type.style === 'plain' && <p className="panel-note">Plain type is set as the font draws it, so the clay controls and type motion are off. Switch Style to Clay to use them.</p>}
        <div className={type.style === 'plain' ? 'muted' : undefined}>
        <Section title="Presets">
          <div className="chips">
            {PRESETS.map((pr) => (
              <button key={pr.id} type="button" className={`chip ${activePreset === pr.id ? 'on' : ''}`} onClick={() => setParams((p) => ({ ...pr.params, seed: p.seed }))}>
                {pr.label}
              </button>
            ))}
          </div>
        </Section>

        <Section
          title="Organic"
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
          {ORGANIC.map((o) => (
            <Slider key={o.key} label={o.label} hint={o.hint} value={params[o.key]} reset={PRESETS[0].params[o.key]} onChange={(v) => setP(o.key, v)} />
          ))}
        </Section>

        <Section
          title="Motion"
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
              hint={`One ${MOTIONS.find((m) => m.id === motion)?.label.toLowerCase()} takes ${(base / typeSpeed).toFixed(1)} s`}
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
          <Section title="Playback">
          {moving && (
            <div className="transport">
              <button type="button" className="btn" onClick={() => setPlaying(!playing)}>
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
      </aside>
    </div>
  )
}

/** Seconds for a label: whole when it is whole, one decimal otherwise. */
const secs = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1))

function Reset({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="link" onClick={onClick}>
      Reset
    </button>
  )
}

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
