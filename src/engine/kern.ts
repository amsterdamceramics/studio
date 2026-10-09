/**
 * Pair kerning straight from the font's GPOS table.
 * opentype.js does not follow extension lookups (type 9), which is where Instrument Sans keeps
 * its kerning, so without this every pair would come back as zero and the setting would drift
 * from what Photoshop and Figma produce.
 */
export function makeKerner(buffer: ArrayBuffer): (left: number, right: number) => number {
  const d = new DataView(buffer)
  const u16 = (o: number) => d.getUint16(o)
  const i16 = (o: number) => d.getInt16(o)
  const tag = (o: number) => String.fromCharCode(d.getUint8(o), d.getUint8(o + 1), d.getUint8(o + 2), d.getUint8(o + 3))

  let gpos = 0
  for (let i = 0, n = u16(4); i < n; i++) if (tag(12 + i * 16) === 'GPOS') gpos = d.getUint32(12 + i * 16 + 8)
  if (!gpos) return () => 0

  const featureList = gpos + u16(gpos + 6)
  const lookupList = gpos + u16(gpos + 8)
  const lookups = new Set<number>()
  for (let i = 0, n = u16(featureList); i < n; i++) {
    if (tag(featureList + 2 + i * 6) !== 'kern') continue
    const f = featureList + u16(featureList + 2 + i * 6 + 4)
    for (let k = 0, m = u16(f + 2); k < m; k++) lookups.add(u16(f + 4 + k * 2))
  }

  const coverage = (o: number): Map<number, number> => {
    const map = new Map<number, number>()
    if (u16(o) === 1) {
      for (let i = 0, n = u16(o + 2); i < n; i++) map.set(u16(o + 4 + i * 2), i)
    } else {
      for (let i = 0, n = u16(o + 2); i < n; i++) {
        const r = o + 4 + i * 6
        for (let g = u16(r), end = u16(r + 2), idx = u16(r + 4); g <= end; g++) map.set(g, idx++)
      }
    }
    return map
  }
  const classDef = (o: number): ((g: number) => number) => {
    const map = new Map<number, number>()
    if (u16(o) === 1) {
      const start = u16(o + 2)
      for (let i = 0, n = u16(o + 4); i < n; i++) map.set(start + i, u16(o + 6 + i * 2))
    } else {
      for (let i = 0, n = u16(o + 2); i < n; i++) {
        const r = o + 4 + i * 6
        for (let g = u16(r), end = u16(r + 2), c = u16(r + 4); g <= end; g++) map.set(g, c)
      }
    }
    return (g) => map.get(g) ?? 0
  }
  const size = (format: number) => {
    let n = 0
    for (let b = format; b; b >>= 1) n += b & 1
    return n * 2
  }
  /** Offset of XAdvance inside a value record, or -1 when the record has none. */
  const advanceAt = (format: number) => (format & 4 ? size(format & 3) : -1)

  const tables: ((l: number, r: number) => number | undefined)[] = []
  const pairPos = (o: number) => {
    const format = u16(o)
    const cov = coverage(o + u16(o + 2))
    const vf1 = u16(o + 4)
    const vf2 = u16(o + 6)
    const adv = advanceAt(vf1)
    if (adv < 0) return
    const rec = size(vf1) + size(vf2)
    if (format === 1) {
      const sets: Map<number, number>[] = []
      for (let i = 0, n = u16(o + 8); i < n; i++) {
        const s = o + u16(o + 10 + i * 2)
        const pairs = new Map<number, number>()
        for (let k = 0, m = u16(s); k < m; k++) {
          const p = s + 2 + k * (2 + rec)
          pairs.set(u16(p), i16(p + 2 + adv))
        }
        sets.push(pairs)
      }
      tables.push((l, r) => {
        const idx = cov.get(l)
        return idx === undefined ? undefined : sets[idx]?.get(r)
      })
    } else if (format === 2) {
      const c1 = classDef(o + u16(o + 8))
      const c2 = classDef(o + u16(o + 10))
      const n2 = u16(o + 14)
      const base = o + 16
      tables.push((l, r) => (cov.has(l) ? i16(base + (c1(l) * n2 + c2(r)) * rec + adv) : undefined))
    }
  }

  for (const index of lookups) {
    const lookup = lookupList + u16(lookupList + 2 + index * 2)
    const type = u16(lookup)
    for (let i = 0, n = u16(lookup + 4); i < n; i++) {
      let sub = lookup + u16(lookup + 6 + i * 2)
      let t = type
      if (t === 9) {
        t = u16(sub + 2)
        sub += d.getUint32(sub + 4)
      }
      if (t === 2) pairPos(sub)
    }
  }

  return (l, r) => {
    for (const t of tables) {
      const v = t(l, r)
      if (v !== undefined) return v
    }
    return 0
  }
}
