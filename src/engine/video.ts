import { ArrayBufferTarget, Muxer } from 'mp4-muxer'

/** The clip's sound, already trimmed and repeated to the length of the export. */
export interface Sound {
  sampleRate: number
  channels: Float32Array[]
}

interface Job {
  canvas: HTMLCanvasElement
  fps: number
  frames: number
  /** Paints frame `i` into the canvas. */
  draw: (i: number) => Promise<void>
  sound?: Sound | null
  onProgress?: (done: number) => void
}

const AVC = ['avc1.640033', 'avc1.4d0033', 'avc1.42e033', 'avc1.640028']

/** True when this browser can encode an MP4 frame by frame, rather than recording the screen live. */
export const canEncode = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'

/**
 * Renders every frame in turn and encodes it at its exact time, so the file plays at an even rate however long
 * each frame takes to draw. A live recording drops frames whenever drawing falls behind the screen.
 */
export async function encodeMp4({ canvas, fps, frames, draw, sound, onProgress }: Job): Promise<Blob> {
  const { width, height } = canvas
  const bitrate = 12_000_000
  let codec = ''
  for (const c of AVC) {
    if ((await VideoEncoder.isConfigSupported({ codec: c, width, height, bitrate })).supported) {
      codec = c
      break
    }
  }
  if (!codec) throw new Error('This browser cannot encode H.264 video')

  const audioOn = !!sound && typeof AudioEncoder !== 'undefined' && (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: sound.sampleRate, numberOfChannels: sound.channels.length, bitrate: 192_000 })).supported
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: audioOn ? { codec: 'aac', sampleRate: sound!.sampleRate, numberOfChannels: sound!.channels.length } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  })

  let failed: Error | null = null
  const video = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failed = e) })
  video.configure({ codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } })

  const step = 1e6 / fps
  for (let i = 0; i < frames; i++) {
    if (failed) throw failed
    await draw(i)
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * step), duration: Math.round(step) })
    // A key frame every two seconds keeps the file easy to scrub.
    video.encode(frame, { keyFrame: i % (fps * 2) === 0 })
    frame.close()
    // Hold back while the encoder catches up, so frames do not pile up in memory.
    while (video.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1))
    onProgress?.((i + 1) / frames)
  }
  await video.flush()
  video.close()

  if (audioOn && sound) {
    const audio = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failed = e) })
    audio.configure({ codec: 'mp4a.40.2', sampleRate: sound.sampleRate, numberOfChannels: sound.channels.length, bitrate: 192_000 })
    const length = sound.channels[0].length
    const block = 4096
    for (let s = 0; s < length; s += block) {
      const n = Math.min(block, length - s)
      const data = new Float32Array(n * sound.channels.length)
      sound.channels.forEach((c, k) => data.set(c.subarray(s, s + n), k * n))
      const chunk = new AudioData({ format: 'f32-planar', sampleRate: sound.sampleRate, numberOfFrames: n, numberOfChannels: sound.channels.length, timestamp: Math.round((s / sound.sampleRate) * 1e6), data })
      audio.encode(chunk)
      chunk.close()
    }
    await audio.flush()
    audio.close()
  }
  if (failed) throw failed
  muxer.finalize()
  return new Blob([muxer.target.buffer], { type: 'video/mp4' })
}

/** The file's sound from `start` for `clip` seconds, repeated to fill `total` seconds. Null when it has none. */
export async function loopedSound(file: Blob, start: number, clip: number, total: number): Promise<Sound | null> {
  const context = new OfflineAudioContext(1, 1, 48000)
  let buffer: AudioBuffer
  try {
    buffer = await context.decodeAudioData(await file.arrayBuffer())
  } catch {
    return null
  }
  const rate = buffer.sampleRate
  const from = Math.round(start * rate)
  const span = Math.max(1, Math.min(Math.round(clip * rate), buffer.length - from))
  const length = Math.round(total * rate)
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, k) => {
    const src = buffer.getChannelData(k)
    const out = new Float32Array(length)
    for (let s = 0; s < length; s++) out[s] = src[from + (s % span)]
    return out
  })
  return { sampleRate: rate, channels }
}
