# `public/exec-lab/` — the approved character asset, and what is missing

This folder holds the one APPROVED CHARACTER ASSET the Command company overview
composites. It exists here so the parenthetical below is a fact rather than an
apology.

## What is here

| File | Size | Alpha | Role |
| --- | --- | --- | --- |
| `exec-head.png` | 212 × 212 | **yes** (transparent, content box 192 × 168) | THE HEAD CUTOUT. In use, at the centre of the orbit. |

`sha256 e9da5a821e73ca138f90e2c9f543bedede7ec97b57efdc768cc40f3e9bc1930c`

It is byte-identical to the copy Agent Studio publishes in its own worktree
(`nexup-exec-experience/public/exec-lab/exec-head.png`, same checksum), and it is
served from the **same public path** — `/exec-lab/exec-head.png` — so the two
worktrees agree on one URL instead of inventing two. Agent Studio's worktree was
READ to establish this; it was never edited.

## What is missing — the reported asset gap

There is **no full-body cutout**: the compact body in the pearl technical jacket
that the approved company overview places at the centre of the orbit, and no
transparent portrait.

| Asset | Where it would live | Status |
| --- | --- | --- |
| Head cutout | `/exec-lab/exec-head.png` | present, in use |
| Full body / portrait cutout | `/exec-lab/exec-portrait.png` | **MISSING as a cutout.** Agent Studio's own portrait is 320 × 320 **RGB with no alpha channel** — its corners measure `#090d11`, i.e. a near-black backdrop, not a transparent field — so it cannot be composited into the composition without someone drawing or keying a new asset. |

The direction is explicit about what to do here: *report the asset gap rather
than drawing a substitute character in CSS*. So the seat renders the approved
**head** at the character's proportionate size and the missing body is reported
in `docs/COMMAND_CHAMPAGNE_HANDOFF.md`, rather than being faked.

## Display contract

These are the numbers the composition actually applies, so a replacement asset
can be judged before it is dropped in.

| Property | Head (in use) | Full body (required) |
| --- | --- | --- |
| Pixel size | 212 × 212, content box 192 × 168 | ≥ 640 × 960 (2:3 portrait), content centred, feet on the bottom edge |
| Format / alpha | PNG, RGBA, transparent field | PNG or lossless WebP, RGBA, fully transparent outside the silhouette |
| Background | none (no baked backdrop or shadow) | none (the UI adds its own drop shadow) |
| Colour | sRGB | sRGB |
| Desktop display | `1.06 × clamp(132px, 13.6vw, 196px)` ≈ **140–208 px**, `object-fit: contain` | same seat and same fit |
| Phone display | **62 × 62 px** (52 px at ≤ 360 px) inside a 72 px disc | same disc and fit |
| Intrinsic attributes | `width=212 height=212`, `draggable=false`, `decoding=async` | width/height required to reserve the seat |
| Failure | seat prints `EXEC`; no drawn substitute | same |

A body cutout must not include its own glow, shadow or rectangular edge: the
seat applies `drop-shadow(0 16px 30px rgba(0,0,0,.66))` and a float animation,
and composites on the warm charcoal (`#0d0e0d`).

## The seam

`src/components/command/state/exec-character.ts` owns the paths:

```ts
export const EXEC_CHARACTER_HEAD = "/exec-lab/exec-head.png";
export const EXEC_CHARACTER_BODY: string | null = null;   // ← the gap
```

When a body cutout is published, setting `EXEC_CHARACTER_BODY` to its path is the
only edit: the seat, its proportion, its focus ring and the phone seat all accept
it already, and a file that fails to load reports itself in the seat's own frame
rather than leaving a hole.
