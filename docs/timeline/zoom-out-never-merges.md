# Zooming out DROPS marks. It never merges them.

The rule, in one line: **N discrete events must never render as one
contiguous shape, at any zoom.** Distance from the data does not turn
seventy-five runs into one four-hour run, and a picture that says it does
is a lie about the data, not a summary of it.

## What the viewer must see

Seventy-five instants, filling the window:

```
|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
```

Zoom out to half the width. HALF THE MARKS, still separated:

```
||||||||||||||||||||||||||||||||||||||
```

NOT this — the marks fused into a bar:

```
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
```

NOT this either — a fixed-pitch comb whose spacing is a constant rather
than the data (see "The two failures" below):

```
◈    ◈    ◈    ◈    ◈    ◈    ◈    ◈    ◈
```

## The rule that produces it

A mark has a fixed width and a guaranteed gap. When the events are
closer together than one mark plus its gap, the extra events are DROPPED
from the drawing, not absorbed into a wider one. The number of marks is
therefore bounded by the width available (`plotWidth / pitch`), which is
exactly why halving the width halves the marks.

Concretely, in `clusterInstants`: instants too close to draw as pips
chain together (the chain is a packing and hit-testing unit, nothing
more), and each chain carries `marks` — its members greedily thinned to
a minimum on-screen pitch. Each mark keeps its member's TRUE timestamp
and stands for the members up to the next mark, which is what its
tooltip counts. Drawing widens nothing and merges nothing.

Losing marks is honest and unavoidable: a display cannot show more marks
than it has pixels. Losing the SEPARATION is neither.

## The two failures this has already produced

1. **The fixed-pitch comb.** A hard cap on cluster width (24px) chopped
   any dense run into equal groups, each drawn as one glyph. Measured on
   240 events in a 1300px window: 48 markers, pitch min 25.0px, max
   25.0px, exactly 5 members each. A lane of 240 events and a lane of 48
   drew IDENTICALLY — the pitch was the cap, never the data.

2. **The density strip.** Its replacement merged marks closer than a
   tick into one wider tick, so a dense run rendered as a solid bar. It
   traded a comb that showed nothing for a bar that stated something
   false: one continuous execution.

Both come from the same reflex — summarizing a crowd instead of
thinning it. Thin it.

## Where this is enforced

- `src/ui/timeline-view-math.ts` — `clusterInstants` builds the thinned
  `marks`; `CLUSTER_MARK_PX` / `CLUSTER_MARK_GAP_PX` set the pitch.
- `src/ui/timeline-view-math.test.ts` — "halving the width halves the
  marks" and "marks never touch" are asserted directly; they fail if
  anything reintroduces merging.
- `src/ui/timeline-view.ts` — `drawClusterMarks` draws one fixed-width
  tick per mark. Nothing there computes a width from a time range.
