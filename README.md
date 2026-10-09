# Amsterdam Ceramics Type

A browser tool that sets type in the Amsterdam Ceramics clay style: the studio's blur-and-threshold recipe computed as a smooth field and delivered as clean Béziers.

```bash
npm install
npm run dev
```

## Layout

```
src/engine/      the deformation engine, no React, runs in Node too
  layout.ts      text -> positioned pieces (opentype.js)
  kern.ts        pair kerning read from GPOS
  geom.ts        offsets and booleans (Clipper2)
  field.ts       area coverage, Gaussian, iso-contour
  pipeline.ts    organic(): ink, bridges, field, contour, settle, fit
  smooth.ts      resampling and Taubin smoothing
  fit.ts         closed-loop cubic Bézier fitting
  animate.ts     motions as pure functions of loop phase
  svg.ts         path data and SVG document
  export.ts      PNG, PDF, download helpers
src/ui/          controls and the live artboard
src/presets.ts   organic presets and brand colours
scripts/render.ts  headless render with the same engine
docs/RESEARCH.md   references, approaches compared, how the engine works
```

## Using the engine elsewhere

```ts
import { BRAND_TYPE, TypeSetter, organic, svgDocument } from './src/engine'

const ts = new TypeSetter(fontArrayBuffer)
const layout = ts.layout({ text: 'clay', align: 'left', textCase: 'none', ...BRAND_TYPE })
const { loops } = organic(layout.pieces, layout.source, params)
```

`organic()` takes generic pieces, so icons, frames and poster shapes can go through the same pipeline: give each a polygon shape and an anchor.

Headless:

```bash
npx tsx scripts/render.ts out.svg 'amsterdam\nceramics' '{"softness":0.5,"blob":0.25,"edgeSmoothness":0.3}'
```

## Font

Instrument Sans (SIL Open Font License) is bundled in `public/fonts`. The tool is locked to Bold.
