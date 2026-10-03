# Sub-spans: a span nested under the span it belongs to

An interval names the interval it is part of through `parentId`. The chart then draws the two as one block. The parent sits on the block's top row. Its sub-spans sit in the rows under it. A faint box in the parent's hue holds the block together.

```
┌─────────────────────────────────────────────────────────┐
│ release v2.37.2                                         │
│   ┌build┐  ┌test──────────────────────┐        ◆ promote│
│            │  unit────┐               │                 │
│            │  e2e──────────────────┐  │                 │
│            └──────────────────────────┘  canary──────┐  │
└─────────────────────────────────────────────────────────┘
```

## What a reader gets

- Containment is a shape, not a legend lookup. Everything inside a box belongs to the span on its top row.
- Depth is recursion. A sub-span with sub-spans of its own gets its own box inside the outer one.
- Nothing inside a box is a stranger. Packing reserves every row of the block over its whole extent.
- Hovering any member lights the box. The tooltip names the parent of a sub-span and lists the sub-spans of a parent.
- The empty part of a box hits the parent. The box is one object.

## The rules

A sub-span nests only under a parent in the same lane. A parent in another lane, a parent that is not loaded, and a parent cycle each leave the interval a root. The interval then draws as any other bar in its own lane.

The block's extent is the union of every member. A sub-span that overruns its parent still has the box cover it. The block is ongoing while the parent or any member is ongoing.

A sub-span bar sits a couple of pixels inside its row. Below the label-fit height, and in a compact lane, the inset is zero.

Row order inside the block is the ordinary first-fit packing of `packTracks`. A sub-span with sub-spans of its own is one item several rows tall. The lane packer sees the whole family the same way. The sticky `TrackAllocator` keeps the block's top row where it was while the block stays on screen, as it does for any bar.

## Where it lives

- `src/ui/timeline-view-math.ts` holds the pure half. `resolveParents` turns the links into a forest. `packFamily` packs one family into a block and reports each member's row offset. `PackItem.rows` lets `packTracks`, `packVisibleTracks` and `TrackAllocator` place a block that is several rows tall.
- `src/ui/timeline-view.ts` resolves families per lane after every data change and packs roots only. It writes each descendant's row from the root's. It draws the box under the root and hits the box last.
- `src/ui/timeline-view-math.test.ts` pins the packing. `scripts/check-timeline-bounds.mjs` drives the real element and reads the painted box back.
- `showcase/` carries the release lane and the `#subspans` instance.

## What this is not

The chart is still not a flame chart. A sub-span is an ordinary interval with an ordinary row. It keeps its category color, its state, its segments and its label. The block adds containment and nothing else.
