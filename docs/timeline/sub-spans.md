# Sub-spans: a span attached under the span it belongs to

An interval names the interval it is part of through `parentId`. The chart then draws the family as a flame chart. The parent sits on the block's top row. Its sub-spans hang directly under it, attached with no gap, in a darker shade of the parent's color. Each row is one depth.

```
▛▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ release v2.32.0 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▜
  ▙ build ▟ ▙ test ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▟ ▙ canary ▄▄▄▄▄▟ ◆ ▙ promote ▟
             ▙ unit ▄▄▟▙ e2e ▄▄▄▄▟
```

## What a reader gets

- Containment is a shape. A sub-span touches the row above it. As a result, the family reads as one connected piece.
- Ownership is a color. Every member keeps its root's hue. Each nesting level is one shade darker, so depth reads at a glance.
- Nothing unrelated sits between a parent and its sub-spans. Packing reserves every row of the block over its whole extent.
- The tooltip names the parent of a sub-span and lists the sub-spans of a parent.

## The rules

A sub-span nests only under a parent in the same lane. A parent in another lane, a parent that is not loaded, and a parent cycle each leave the interval a root. The interval then draws as any other bar in its own lane.

A sub-span takes its root's category for its hue. Its own `category` does not change the color. Its `state` still applies, so a failed sub-span keeps the failed treatment in the family's shade. A `colorFor` override still wins.

Siblings run one after another. A sub-span that overlaps a sibling is invalid data. The chart draws it on the same row and reports it once with `console.error`. It never adds a row to hide the overlap.

A sub-span bar reaches up through the track gap to its parent. Its top corners are square. The bar above casts a short shadow onto its top edge. As a result, the join reads as tucked under and not as missing padding. A span with sub-spans has square bottom corners. An instant sub-span stays a pip.

The block's extent is the union of every member. The block is ongoing while the parent or any member is ongoing.

A member's row inside the block is its depth. The block is as tall as its deepest branch. The lane packer sees the whole family as one item several rows tall. The sticky `TrackAllocator` keeps the block's top row where it was while the block stays on screen, as it does for any bar.

## Where it lives

- `src/ui/timeline-view-math.ts` holds the pure half. `resolveParents` turns the links into a forest. `packFamily` packs one family into a block and reports each member's row offset. `PackItem.rows` lets `packTracks`, `packVisibleTracks` and `TrackAllocator` place a block that is several rows tall.
- `src/ui/timeline-view.ts` resolves families per lane after every data change and packs roots only. It writes each descendant's row from the root's. It shades each member from its root's category by depth, and draws each sub-span attached to the row above.
- `src/ui/timeline-view-math.test.ts` pins the packing. `scripts/check-timeline-bounds.mjs` drives the real element. It reads the canvas back to prove the sub-span fills the gap, keeps the parent's hue and is darker.
- `showcase/` carries the release lane and the `#subspans` instance.

## What a sub-span keeps

A sub-span is an ordinary interval. It keeps its state, its segments and its label. Only its color and its row come from the family.
