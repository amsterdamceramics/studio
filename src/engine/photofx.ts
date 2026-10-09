import type { GradientMap, Placement } from './image'

/**
 * Effects that move through a still photo. The photo itself never moves: what travels is where
 * it is blurred, where the gradient map applies, or where it collapses into two clay tones.
 *
 * Everything is one fragment shader, so the effects run at full board resolution in real time
 * and a still export is simply the same shader at a larger size.
 */

export type PhotoEffect = 'off' | 'blurBleed' | 'clayBleed' | 'toneRise' | 'rampSwap' | 'focusPass' | 'clayPass' | 'breathingClay' | 'toneBands'

export const PHOTO_EFFECTS: { id: PhotoEffect; label: string; hint: string }[] = [
  { id: 'off', label: 'None', hint: 'The photo is still' },
  { id: 'blurBleed', label: 'Blur bleed', hint: 'The photo goes soft in a few spots that spread and draw back like breathing' },
  { id: 'clayBleed', label: 'Clay bleed', hint: 'Black and white, with clay-edged spots where it turns into two flat coloured tones' },
  { id: 'toneRise', label: 'Tone rise', hint: 'Black and white; colour reaches the shadows first, climbs to the highlights, and drains back' },
  { id: 'rampSwap', label: 'Ramp swap', hint: 'Always in colour: the photo pulses to a second ramp and back' },
  { id: 'focusPass', label: 'Focus pass', hint: 'A soft band crosses the photo; it blurs inside the band and sharpens behind it' },
  { id: 'clayPass', label: 'Clay pass', hint: 'A band crosses the photo and collapses it into two clay-edged tones as it goes' },
  { id: 'breathingClay', label: 'Breathing clay', hint: 'The whole photo leans toward two tones and back, the shapes swelling as it does' },
  { id: 'toneBands', label: 'Tone bands', hint: 'The ramp wraps over the tones and slides, so contour bands flow through the photo' },
]

export interface FxFrame {
  /** Output size in pixels: the board, at whatever density is being drawn. */
  width: number
  height: number
  place: Placement
  map: GradientMap
  effect: PhotoEffect
  /** Loop phase 0..1; 0 and 1 are the same frame. */
  phase: number
  /** 0..1: how far the effect goes at its peak. 0 leaves the photo as it rests. */
  strength: number
  /** The second ramp, for Ramp swap. */
  swapTo: { shadow: string; highlight: string }
  /** Picks where the bleed spots sit. */
  seed: number
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPhoto;
uniform sampler2D uBlur;
uniform sampler2D uNoise;
uniform vec4 uXform;
uniform float uAspect;
uniform float uPhase;
uniform float uStrength;
uniform int uEffect;
uniform vec3 uLoA;
uniform vec3 uHiA;
uniform vec3 uLoB;
uniform vec3 uHiB;
uniform float uMapOn;
uniform float uGamma;
uniform float uGain;
uniform vec4 uSpots[8];

float curve(float l) {
  float t = pow(clamp(l, 0.0, 1.0), uGamma);
  return clamp((t - 0.5) * uGain + 0.5, 0.0, 1.0);
}
float swell(float p) { return 0.5 - 0.5 * cos(p * 6.2831853); }
// Rises, holds near the top, and falls, so the changed state gets time on screen.
float hold(float p) { return smoothstep(0.08, 0.38, p) * (1.0 - smoothstep(0.62, 0.92, p)); }
// The travelling band the type's Wave uses: it starts and ends fully outside the frame.
float band(float x, float w) {
  float cx = -2.6 * w + uPhase * (1.0 + 5.2 * w);
  float d = (x - cx) / w;
  return exp(-d * d);
}
// Ink bleed: each spot spreads and draws back on its own beat; noise pushes the edge around
// so it feathers like ink in wet paper instead of drawing a disc.
float bleed(vec2 uv, vec2 n, float feather) {
  float wobble = 1.0 + (n.x - 0.5) * 0.9 + (n.y - 0.5) * 0.5;
  float best = -10.0;
  for (int k = 0; k < 8; k++) {
    vec4 s = uSpots[k];
    float reach = swell(fract(uPhase + s.w)) * s.z;
    float d = length((uv - s.xy) * vec2(1.0, uAspect)) * wobble;
    best = max(best, reach - d);
  }
  return smoothstep(-feather, feather, best);
}

void main() {
  vec2 puv = uXform.xy + vUv * uXform.zw;
  vec3 src = texture2D(uPhoto, puv).rgb;
  vec2 blurred = texture2D(uBlur, puv).rg;
  vec2 n = texture2D(uNoise, vUv * vec2(1.0, uAspect)).rg;

  float raw = dot(src, vec3(0.2126, 0.7152, 0.0722));
  float L = curve(raw);
  float softL = curve(blurred.r);
  float clayL = curve(blurred.g);

  float tone = L;     // which tone of the ramp a pixel shows
  float colour = 1.0; // 0 black and white, 1 the ramp
  float swap = 0.0;   // 0 this ramp, 1 the second one

  // Strength scales how far each effect goes at its peak; the resting photo is untouched by it.
  float s = clamp(uStrength, 0.0, 1.0);
  if (uEffect == 1) {
    tone = mix(L, clayL, bleed(vUv, n, 0.072) * s);
  } else if (uEffect == 2) {
    float m = bleed(vUv, n, 0.004) * s;
    tone = mix(L, smoothstep(0.46, 0.54, clayL), m);
    colour = m;
  } else if (uEffect == 3) {
    colour = smoothstep(-0.12, 0.12, swell(uPhase) * 1.3 - 0.15 - softL) * s;
  } else if (uEffect == 4) {
    swap = hold(uPhase) * s;
  } else if (uEffect == 5) {
    tone = mix(L, clayL, band(vUv.x, 0.28) * s);
  } else if (uEffect == 6) {
    tone = mix(L, smoothstep(0.47, 0.53, clayL), band(vUv.x, 0.28) * s);
  } else if (uEffect == 7) {
    float level = 0.5 + 0.14 * sin(uPhase * 6.2831853);
    float amount = (0.45 + 0.4 * swell(uPhase)) * s;
    tone = mix(L, smoothstep(level - 0.04, level + 0.04, softL), amount);
  } else if (uEffect == 8) {
    float f = fract(softL * 3.0 + uPhase);
    tone = mix(L, f < 0.5 ? f * 2.0 : 2.0 - f * 2.0, s);
  }

  vec3 lo = mix(uLoA, uLoB, swap);
  vec3 hi = mix(uHiA, uHiB, swap);
  // With the gradient map off the photo keeps its own colours and the effects change only its tones.
  vec3 own = clamp(src * min(tone / max(raw, 0.004), 4.0), 0.0, 1.0);
  vec3 mapped = uMapOn > 0.5 ? mix(lo, hi, tone) : own;
  gl_FragColor = vec4(mix(vec3(tone), mapped, colour), 1.0);
}`

const EFFECT_ID: Record<PhotoEffect, number> = {
  off: 0,
  blurBleed: 1,
  clayBleed: 2,
  toneRise: 3,
  rampSwap: 4,
  focusPass: 5,
  clayPass: 6,
  breathingClay: 7,
  toneBands: 8,
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Three box passes, close enough to a Gaussian, on a single-channel field. */
function boxBlur(src: Float32Array, w: number, h: number, radius: number, wrap = false): Float32Array {
  const at = (v: number, max: number) => (wrap ? ((v % max) + max) % max : Math.min(max - 1, Math.max(0, v)))
  let a = Float32Array.from(src)
  const b = new Float32Array(w * h)
  const span = radius * 2 + 1
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0
      for (let x = -radius; x <= radius; x++) sum += a[y * w + at(x, w)]
      for (let x = 0; x < w; x++) {
        b[y * w + x] = sum / span
        sum += a[y * w + at(x + radius + 1, w)] - a[y * w + at(x - radius, w)]
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let y = -radius; y <= radius; y++) sum += b[at(y, h) * w + x]
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / span
        sum += b[at(y + radius + 1, h) * w + x] - b[at(y - radius, h) * w + x]
      }
    }
  }
  return a
}

/** A 256 px tile that repeats: R is slow, lumpy noise for the clay outline, G is fine noise for the feathering. */
function noiseTile(): Uint8Array {
  const S = 256
  const hash = (x: number, y: number, k: number) => {
    const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453
    return v - Math.floor(v)
  }
  const value = (x: number, y: number, cells: number, k: number) => {
    const fx = (x / S) * cells
    const fy = (y / S) * cells
    const xi = Math.floor(fx)
    const yi = Math.floor(fy)
    const u = (fx - xi) * (fx - xi) * (3 - 2 * (fx - xi))
    const v = (fy - yi) * (fy - yi) * (3 - 2 * (fy - yi))
    const g = (i: number, j: number) => hash(((xi + i) % cells + cells) % cells, ((yi + j) % cells + cells) % cells, k)
    return (g(0, 0) * (1 - u) + g(1, 0) * u) * (1 - v) + (g(0, 1) * (1 - u) + g(1, 1) * u) * v
  }
  const white = new Float32Array(S * S)
  for (let i = 0; i < S * S; i++) white[i] = hash(i % S, Math.floor(i / S), 9)
  const fine = boxBlur(white, S, S, 2, true)
  let min = 1
  let max = 0
  for (const v of fine) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const out = new Uint8Array(S * S * 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      out[i * 4] = (value(x, y, 5, 1) * 0.65 + value(x, y, 13, 2) * 0.35) * 255
      out[i * 4 + 1] = ((fine[i] - min) / (max - min)) * 255
      out[i * 4 + 3] = 255
    }
  }
  return out
}

function spots(seed: number): Float32Array {
  let s = (Math.floor(seed) * 2654435761 + 7) >>> 0
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const out = new Float32Array(32)
  for (let k = 0; k < 8; k++) {
    out[k * 4] = 0.1 + rnd() * 0.8
    out[k * 4 + 1] = 0.08 + rnd() * 0.84
    out[k * 4 + 2] = 0.16 + rnd() * 0.2
    out[k * 4 + 3] = rnd()
  }
  return out
}

export class PhotoFx {
  readonly canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext
  private mips: boolean
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private photo: WebGLTexture
  private blur: WebGLTexture
  private size = { w: 1, h: 1 }

  /** Null when the browser has no WebGL; the caller then shows the photo without effects. */
  static create(): PhotoFx | null {
    try {
      return new PhotoFx()
    } catch {
      return null
    }
  }

  private constructor() {
    this.canvas = document.createElement('canvas')
    const options = { preserveDrawingBuffer: true, antialias: false, alpha: false }
    const gl2 = this.canvas.getContext('webgl2', options) as WebGLRenderingContext | null
    const gl = gl2 ?? (this.canvas.getContext('webgl', options) as WebGLRenderingContext | null)
    if (!gl) throw new Error('WebGL is not available')
    this.gl = gl
    this.mips = !!gl2

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed to compile')
      return shader
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader failed to link')
    gl.useProgram(program)

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const pos = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)

    for (const name of ['uPhoto', 'uBlur', 'uNoise', 'uXform', 'uAspect', 'uPhase', 'uStrength', 'uEffect', 'uLoA', 'uHiA', 'uLoB', 'uHiB', 'uMapOn', 'uGamma', 'uGain', 'uSpots']) {
      this.uniforms[name] = gl.getUniformLocation(program, name)
    }

    const texture = (unit: number, repeat: boolean) => {
      const t = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, t)
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      return t
    }
    this.photo = texture(0, false)
    this.blur = texture(1, false)
    texture(2, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseTile())
    gl.uniform1i(this.uniforms.uPhoto, 0)
    gl.uniform1i(this.uniforms.uBlur, 1)
    gl.uniform1i(this.uniforms.uNoise, 2)
  }

  /** Upload a photo, and the two blurred versions of its tones the effects lean on. */
  setPhoto(photo: HTMLCanvasElement) {
    const gl = this.gl
    this.size = { w: photo.width, h: photo.height }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.photo)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, photo)
    if (this.mips) {
      // Mipmaps keep a large photo from shimmering when it is drawn small.
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    }

    // The blurred tones are smooth by nature, so a small copy is enough and costs almost nothing.
    const k = 384 / Math.max(photo.width, photo.height)
    const w = Math.max(8, Math.round(photo.width * k))
    const h = Math.max(8, Math.round(photo.height * k))
    const small = document.createElement('canvas')
    small.width = w
    small.height = h
    const ctx = small.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(photo, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    const lum = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) lum[i] = (d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722) / 255
    const soft = boxBlur(lum, w, h, Math.max(1, Math.round(Math.max(w, h) * 0.009)))
    const clay = boxBlur(lum, w, h, Math.max(2, Math.round(Math.max(w, h) * 0.02)))
    const packed = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      packed[i * 4] = soft[i] * 255
      packed[i * 4 + 1] = clay[i] * 255
      packed[i * 4 + 3] = 255
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.blur)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, packed)
  }

  /** Draw one frame. The returned canvas is reused, so copy it out before rendering the next. */
  render(f: FxFrame): HTMLCanvasElement {
    const gl = this.gl
    const u = this.uniforms
    const W = Math.max(1, Math.round(f.width))
    const H = Math.max(1, Math.round(f.height))
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W
      this.canvas.height = H
    }
    gl.viewport(0, 0, W, H)

    // Cover the board with the photo, then crop in by the zoom and slide within the slack.
    const board = W / H
    const photo = this.size.w / this.size.h
    const sx = Math.min(1, board / photo) / f.place.zoom
    const sy = Math.min(1, photo / board) / f.place.zoom
    gl.uniform4f(u.uXform, ((1 - sx) / 2) * (1 + f.place.x), ((1 - sy) / 2) * (1 + f.place.y), sx, sy)
    gl.uniform1f(u.uAspect, H / W)
    gl.uniform1f(u.uPhase, f.phase)
    gl.uniform1f(u.uStrength, f.strength)
    gl.uniform1i(u.uEffect, EFFECT_ID[f.effect])
    gl.uniform3fv(u.uLoA, rgb(f.map.shadow))
    gl.uniform3fv(u.uHiA, rgb(f.map.highlight))
    gl.uniform3fv(u.uLoB, rgb(f.swapTo.shadow))
    gl.uniform3fv(u.uHiB, rgb(f.swapTo.highlight))
    gl.uniform1f(u.uMapOn, f.map.enabled ? 1 : 0)
    gl.uniform1f(u.uGamma, Math.pow(2, -f.map.brightness * 1.5))
    gl.uniform1f(u.uGain, f.map.contrast >= 0 ? 1 + f.map.contrast * 2 : 1 + f.map.contrast * 0.9)
    gl.uniform4fv(u.uSpots, spots(f.seed))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.canvas
  }
}
