# Zooming out DROPS marks. It never merges them.

The rule, in one line: **N discrete events must never render as one contiguous shape, at any zoom.** Distance from the data does not turn seventy-five runs into one four-hour run. A picture that says it does is a lie about the data, not a summary of it.

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

NOT this either — a fixed-pitch comb whose spacing is a constant rather than the data (see "The two failures" below):

```
◈    ◈    ◈    ◈    ◈    ◈    ◈    ◈    ◈
```

## The rule that produces it

A mark has a fixed width and a guaranteed gap. When the events are closer together than one mark plus its gap, the extra events are DROPPED from the drawing. They are not absorbed into a wider one. The number of marks is therefore bounded by the width available (`plotWidth / pitch`), which is exactly why halving the width halves the marks.

Concretely, in `clusterInstants`: instants too close to draw as pips chain together, and each chain carries `marks`. The chain is a packing and hit-testing unit, nothing more. A chain's `marks` are its members greedily thinned to a minimum on-screen pitch. Each mark keeps its member's TRUE timestamp and stands for the members up to the next mark, which is what its tooltip counts. Drawing widens nothing and merges nothing.

Losing marks is honest and unavoidable: a display cannot show more marks than it has pixels. Losing the SEPARATION is neither.

## The two failures this has already produced

1. **The fixed-pitch comb.** A hard cap on cluster width (24px) chopped any dense run into equal groups, each drawn as one glyph. Measured on 240 events in a 1300px window: 48 markers, pitch min 25.0px, max 25.0px, exactly 5 members each. A lane of 240 events and a lane of 48 drew IDENTICALLY — the pitch was the cap, never the data.
2. **The density strip.** Its replacement merged marks closer than a tick into one wider tick, so a dense run rendered as a solid bar. It traded a comb that showed nothing for a bar that stated something false: one continuous execution.

Both come from the same reflex — summarizing a crowd instead of thinning it. Thin it.

## Where this is enforced

- `src/ui/timeline-view-math.ts` — `clusterInstants` builds the thinned `marks`. The pitch is the drawn pip's own width times `CLUSTER_OVERLAP_FRAC`, floored at `CLUSTER_MIN_PITCH_PX`. That fraction is 0.5, so consecutive marks OVERLAP by half a glyph rather than sitting in a comb. One constant decides both chaining and thinning, so the two can never disagree.
- `src/ui/timeline-view-math.test.ts` — "ZOOMING OUT HALVES THE MARKS — it never fuses them into one shape" and "a run of marks fills its extent — no fixed-pitch comb, no single blob" assert it directly. They fail if anything reintroduces merging.
- `src/ui/timeline-view.ts` — `drawClusterMarks` draws each mark as the ordinary instant glyph, off the shared `pipSprite` bake. The glyph is a diamond, or a dot once the row is compact. Nothing there computes a width from a time range, and no other glyph is substituted at any zoom.
