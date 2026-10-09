// Headless render, same engine as the app: npx tsx scripts/render.ts out.svg 'amsterdam\\nceramics' '{"softness":0.9}' '{"tracking":-0.06}'
import { readFileSync, writeFileSync } from 'node:fs'
import { TypeSetter } from '../src/engine/layout'
import { organic } from '../src/engine/pipeline'
import { svgDocument } from '../src/engine/svg'
import { EM, ZERO_PARAMS } from '../src/engine/types'

const buf = readFileSync(new URL('../public/fonts/InstrumentSans-Bold.ttf', import.meta.url))
const ts = new TypeSetter(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const [out, text, json, layoutJson] = process.argv.slice(2)
const lo = { align: 'left', textCase: 'none', tracking: -0.06, lineHeight: 0.95, ...(layoutJson ? JSON.parse(layoutJson) : {}), text: text.replace(/\\n/g, '\n') }
const layout = ts.layout(lo as any)
const params = { ...ZERO_PARAMS, ...JSON.parse(json || '{}') }
const r = organic(layout.pieces, layout.source, params)
const pad = EM * 0.25
const frame = { x: layout.box.x - pad, y: layout.box.y - pad, w: layout.box.w + pad * 2, h: layout.box.h + pad * 2, scale: 200 / EM }
writeFileSync(out, svgDocument(r.loops, frame, '#000', '#fff'))
console.log(`${out}: ${layout.pieces.length} glyphs, ${r.loops.length} contours, ${r.nodes} points, ${r.ms.toFixed(0)} ms`)
