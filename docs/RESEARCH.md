# Amsterdam Ceramics Type: research and engine design

## 1. What was studied

| Reference | Status | What it gave |
| --- | --- | --- |
| amsterdamceramics.com | Read; logo (black, acid, white) and the `ac27` clay graphic downloaded and measured | The ground truth for this build |
| Screengrab of the brand type settings | Read | Instrument Sans Bold, line height 120%, letter spacing -2% |
| Savee animation `fzSrvhQ` ("lab") | Video pulled, 12 frames inspected | The motion reference |
| Figma file `b3luBAYkLlvPdwfnzDUjtT`, node 295:66 | **Not accessible**: the connected Figma account has no access and the share link needs a login | Nothing yet |
| Instagram @amsterdam.ceramics | **Not accessible** without a login | Nothing yet |

Everything below is therefore calibrated against the published logo and `ac27` mark, not against the Figma artboards.

## 2. How the reference artwork is constructed

Measured on the published logo:

- **Font**: Instrument Sans Bold, unmodified proportions. Stem 0.150 em, x-height 0.51 em.
- **Tracking is very tight, about -6 to -7%.** The wordmark's width-to-x-height ratio (8.9) only works out if neighbouring stems already touch before any softening. Most of the fusing comes from this, not from a large blur.
- **Line pitch about 0.74 em**, so the dot of the `i` reaches the `r` above and forms the drip between the lines.
- **Weight gain is small**: stroke to x-height goes from 0.29 to about 0.34, roughly +0.01 to +0.02 em per side.
- **Terminals are fully round** (radius about half a stem), while **gaps of 0.02 em and up survive** as slits and pinholes between letters. So the rounding scale is large and the bridging scale is small.
- **Mass gathers at junctions**: arches hump, stems waist slightly, feet are bulbous.
- **Top and bottom edges scallop** where neighbouring letters bridge.
- Counters shrink to small ovals but stay open; apertures of `a e s c` narrow to notches.

This is the signature of blur plus threshold on tightly set type. Blur plus threshold does four things at once, and the engine needs each as a separate, controllable step:

1. convex corners retreat (rounding),
2. concave corners and narrow gaps advance (fillets and bridges),
3. thick regions gain more than thin ones (mass),
4. everything relaxes to continuous curvature.

The motion reference shows a fifth idea: the effect is **local in space**. A swell travels through the word; letters outside it are crisp type.

## 3. Approaches compared

| Approach | Vector throughout | Local control | Counters | Output quality | Verdict |
| --- | --- | --- | --- | --- | --- |
| Blur + threshold + trace (SVG `feGaussianBlur`/`feColorMatrix` "gooey" filter, Photoshop, potrace) | No | None, one global radius | Close up unpredictably | Trace noise, hundreds of points | Rejected by the brief, and by the results |
| Metaballs / implicit field + marching squares | No, it samples a grid | Per-ball | Not type-aware | Grid-resolution artefacts | Good for blobs, wrong for letters |
| SDF smooth-min union per glyph | No, needs contouring | Per glyph | Fair | Same sampling problem | Elegant on a GPU, not editable vectors |
| Paper.js booleans + `path.smooth()` | Yes | Manual | Manual | Curves stay Béziers, but Paper has **no robust offset**, which is the core operation here | Missing the key primitive |
| Stroke-based: skeletonise, re-stroke with round caps | Yes | Good | Good | Needs a medial axis of arbitrary glyphs; fragile at junctions | Too brittle for production |
| Point-relaxation / spring physics on outlines | Yes | Good | Poor, self-intersections | Non-deterministic, hard to bound | Reads as "melted" |
| **Polygon morphology: offsets and booleans (Clipper2), then curvature relaxation and Bézier fitting** | **Yes** | **Per glyph and per pair** | **Explicit** | **Exact arcs, then least-squares cubics** | **Chosen** |

### Why morphology

Mathematical morphology gives each blur-threshold behaviour as an exact vector operation built from one primitive, the round offset:

- **closing** (grow r, shrink r) fills concave corners with radius-r fillets and bridges gaps narrower than 2r, and never removes material;
- **opening** (shrink r, grow r) rounds convex corners with radius r;
- **opening at radius r selects the regions thick enough to hold a disc of radius r**, which is a direct, resolution-free measure of local mass.

Offsets of polygons are exact arcs and lines. Nothing is sampled on a grid, so the pipeline stays resolution-independent and deterministic, and because every stage is a set operation the result can never self-intersect.

### Libraries evaluated

- **Clipper2** (via `clipper2-ts`, a pure TypeScript port): robust integer booleans and round-join offsets. Chosen. No WASM to load, runs the same in the browser and in Node.
- **opentype.js**: glyph outlines, advances, kerning. Chosen. Its GSUB shaper cannot run Instrument Sans's contextual lookups, so glyphs are looked up per character.
- **Paper.js**: best-in-class path model and `simplify()`, but no offsetting and a heavy scene graph. Its simplifier is Schneider's algorithm, which is reimplemented here with closed-loop tangent sharing.
- **PolyBool, martinez**: booleans only.
- **Bezier.js**: per-curve offset approximations, not shape offsets.
- **Rough.js, Two.js, SVG.js, p5.js**: renderers and sketch styles, not geometry kernels.
- **Fontkit**: stronger shaping than opentype.js; worth switching to if ligatures or variable axes are needed.

## 4. The deformation engine (revised after seeing the Photoshop recipe)

The first build used pure polygon morphology (section 3). It got the character right but not the exact curves, because the studio's artwork is literally Gaussian blur followed by a threshold. The engine now computes that recipe directly, as mathematics rather than as pixels:

| Stage | Operation | Controls |
| --- | --- | --- |
| 1. Ink | Union of the glyph outlines (Clipper2) | |
| 2. Extra bridges | Closing of the whole word minus the closing of each glyph alone: only material that exists because two letters are near each other | Merge distance, Merge strength |
| 3. Counter allowance | Counters are opened beforehand by what the swell will take back | Counter protection |
| 4. Field | Exact area coverage of the ink, convolved with a Gaussian | Softness (sigma, up to 0.09 em) |
| 5. Contour | The iso-line where the field crosses a level, located by interpolation | Blob amount (level 0.50 down to 0.16) |
| 6. Settle and fit | Uniform resample, seeded drift, Taubin smoothing, Schneider cubic fitting with shared tangents | Noise, Edge smoothness |

Why this is not "rasterise and trace": a trace follows the stair-steps of thresholded pixels. Here the threshold is never applied to pixels. The blurred field is smooth, so its iso-line is found between samples to a small fraction of a cell, at three or more cells per sigma, and what gets fitted is that smooth curve. The grid is em-relative, so output is identical at every size.

### Calibration against the Photoshop sample

`10 days / left to apply`, Gaussian Blur 9 px + Field Blur 10 px + Threshold 190, fitted by overlap:

- type 270 px, **tracking about -6%, leading 80%** (these are now locked as `BRAND_TYPE`; the Figma screengrab's -2% / 120% does not reproduce the artwork)
- effective sigma 12 px = **0.045 em** (softness 0.5)
- effective ink level **0.415** (blob 0.25). Photoshop's 190 is not 25% ink because it blurs and thresholds gamma-encoded values.
- overlap with the screenshot 0.91 intersection-over-union; the remainder is a one-pixel fringe from aligning a downsampled screenshot.

The fit also exposed that opentype.js returned zero for every kerning pair (Instrument Sans stores kerning in GPOS extension lookups). `kern.ts` reads the table directly.

## 5. Output

One compound path of absolute cubics, two decimals, non-zero fill. The sample above is about 255 points. PDF is written by hand from the same cubics as native path operators. PNG and video draw the same path to a canvas.

## 6. Animation

Each motion is a pure function of loop phase that moves the same parameters the sliders move. Wave blends a crisp field into the soft one, and its level with it, under a weight that travels across the word (the Savee reference). Morph, Breathe, Wobble (cross-faded noise, loops exactly) and Settle (damped overshoot) scale softness and blob. Every frame is regenerated, so letters fusing and counters closing need no special handling.

## 7. Performance

6 to 30 ms per update for a headline, so sliders and motion run live.

## 8. Known gaps

- Not yet compared against the Figma artboards (access).
- Calibrated on one Photoshop sample and the published logo.
- No ligatures or OpenType features beyond kerning.
- Bézier nodes are placed by error, not at extrema.
- Video export is real-time capture, so its frame rate depends on the machine.
