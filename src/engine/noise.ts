/** Seeded 3D gradient noise in roughly -1..1. Deterministic, so a seed always gives the same artwork. */
export function makeNoise(seed: number) {
  const perm = new Uint8Array(512)
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  let s = (Math.floor(seed) * 2654435761) >>> 0 || 1
  for (let i = 255; i > 0; i--) {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    const j = s % (i + 1)
    const t = p[i]
    p[i] = p[j]
    p[j] = t
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const grad = (h: number, x: number, y: number, z: number) => {
    const g = h & 15
    const u = g < 8 ? x : y
    const v = g < 4 ? y : g === 12 || g === 14 ? x : z
    return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v)
  }

  return (x: number, y: number, z: number) => {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const Z = Math.floor(z) & 255
    x -= Math.floor(x)
    y -= Math.floor(y)
    z -= Math.floor(z)
    const u = fade(x)
    const v = fade(y)
    const w = fade(z)
    const A = perm[X] + Y
    const AA = perm[A] + Z
    const AB = perm[A + 1] + Z
    const B = perm[X + 1] + Y
    const BA = perm[B] + Z
    const BB = perm[B + 1] + Z
    return lerp(
      lerp(
        lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
        lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u),
        v,
      ),
      lerp(
        lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    )
  }
}
