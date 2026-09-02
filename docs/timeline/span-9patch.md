# Spans are drawn as paths, not 9-patches. Here is the measurement.

A span is a rounded bar: fill, a 1px border, sometimes a 45-degree hatch. All of that is cacheable in principle — bake `[cap | middle | cap]` once and blit it per bar, stretching or tiling the middle. This is what the pips do, where it is worth roughly 6x. The question is whether spans need it too. They do not. The reason is not the one the first measurement suggested.

## The number that decides it

`bench/bench-gl.html` ramps each method until presented frames hold 30fps, freezes the count and samples 5s. Spans per frame:

| method | path | 9-patch, snapped | 9-patch, sub-pixel |
| --- | --- | --- | --- |
| hatched | 399 | 762 | 416 |
| solid | 1576 | 733 | 690 |

(SwiftShader, no GPU — treat the ratios inside a row as the signal and never the absolute numbers. Run-to-run spread on that renderer is about 20%, which is why 416-vs-399 is a wash and not a win.)

**Snapped means every bar rounded to whole device pixels.** That is the column where the 9-patch looks good. It is also the column the component cannot have. `renderView` is the single global rounding step, precisely so bars do not move relative to each other during a fractional pan. Rounding again per bar makes each one walk by up to a pixel against its neighbours, the axis ticks, and the lanes above it. `anchorPattern` exists for the same reason on the texture. It phases the hatch to the span's own unrounded origin. The pattern then travels with the bar, instead of the bar sliding across a hatch pinned to the canvas.

So the row that matters is the sub-pixel one, where blits resample. The hatched 9-patch ties the path, and the solid one loses by 2.3x. A stretched solid middle is one blit. It has every reason to win. It still does not.

## The bug that nearly buried this

The first version baked a middle exactly one hatch period (5px) wide. Every blit boundary resamples about a pixel of the slice's edge, so a fifth of the tile sat on a seam. The reconstructed hatch then rendered as disconnected dashes with a visible seam per tile, next to a path version drawing continuous diagonals. That looked like proof the technique was unusable. It was proof the strip was too narrow: at four periods the sub-pixel 9-patch and the path render alike.

The lesson is the ordinary one — a technique that looks broken is a bug in the harness until the harness has been fixed once.

## Why this is not close, beyond the numbers

Hatched spans never approach the throughput where any of this pays. A dense chart puts tens of hatched bars on screen, not hundreds. The worst row above still sustains 399 per frame on a software rasterizer. Pips are the opposite case — thousands per frame at a wide zoom — which is exactly why they are sprited and spans are not.

A span sprite also needs a cache key of (style, track height, corner radius, dpr). It covers only a bar with no phase segments. Segments are drawn inside one clip of the bar's path, as plain `fillRect`s. That is already cheaper than the blit sequence that replaces them.

## If this is revisited

Re-measure on real hardware, and only look at the sub-pixel row. The snapped row answers a question the component is not allowed to ask.
