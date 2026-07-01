# Wall Sort — v1 design

_Approved 2026-07-01._

**What you see:** A phone-portrait screen filled by a wall of colored rectangular
tiles in columns. The top edge is always a straight, level line, so it reads as a
solid wall. Tucked between tiles at set intervals are numbered **separator blocks**
(default 10). Flat, front-on view — no 3D camera tricks.

**What you do:** Tap a column. The run of same-colored tiles at its top flips loose
and glides right along the top of the wall to the **next column of that color**
(wrapping around the right edge back to the left). It lands on that column's top and
pushes everything below it down. If no other column shares that color, the move is
rejected — the tapped column gives a small shake + a muted tick, nothing moves.

**Completing a group:** A separator wants **10 same-colored tiles directly on it and
nothing else**. While the stack on it is pure one color, its number counts down as the
group grows; the moment a different color is mixed in, it goes inactive until it's pure
again. At its target, those tiles pop in a satisfying match, the separator clears, and
the tiles below rise to close the gap — the column "moves up," tops still level.

**Winning:** Clear the whole wall — every separator satisfied. Levels are authored so
it's always _possible_: total tiles = the sum of all separator numbers, and every
color's count is a multiple of 10. If play strands you in a dead end (no legal move),
the game detects it and offers **Restart**; there's also an **Undo**.

**Menu:** Level select · **Editor** (build your own; enforces the
color-count-multiple-of-10 rule so you can't save an unsolvable level) · settings.

**Ships in v1:** 3 starter levels (first tutorial-trivial) + the editor.

**Defaults:** 4 colors to start · portrait phone framing · one tap = one move.

## Implementation notes / rules pinned during build

- **Fly target:** from the tapped column, scan rightward (wrapping) to the next column
  whose top run is the same color. The tapped column is excluded; no other match = invalid.
- **Top run:** the manipulable unit is the contiguous same-color run at the very top of a
  column (it lives in the top band, above the topmost separator).
- **Separator band:** the contiguous tiles directly above a separator, up to the next
  separator or the column top. A separator matches when that band is a single color and
  its size is ≥ target; exactly `target` tiles nearest the separator clear (any overshoot
  remainder stays on top and drops down). Counter shows `max(0, target - bandCount)` and
  is shown inactive while the band is mixed.
- **Resolution runs at level start too**, so authored levels that begin already-complete
  resolve correctly, and clears cascade.
- **Targets are all 10 in v1**, which is what makes "each color a multiple of 10" the
  solvability rule.
