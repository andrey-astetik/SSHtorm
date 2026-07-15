# Icon pack — style guidelines

## Core philosophy

These are **outline icons drawn as fills**. They look like stroked shapes but technically
contain no `stroke` attributes — every "line" is a closed filled path. Draw in Figma with
strokes, then flatten: **Object → Outline Stroke → Export as path**.

---

## Visual style

### Weight
Medium weight — not hairline, not bold. The effective line thickness is ~1.33px on a 20px
grid (~6.7% of the canvas). This should feel like a "regular" weight in UI: comfortable,
neutral, never delicate or heavy.

If an icon feels too thin it looks fragile. If it feels too thick it looks chunky. Neither
should happen — use existing icons as a visual reference before committing.

### Corner language
**All corners are rounded.** No hard 90° angles anywhere — not in boxes, not in arrow tips,
not in chevrons. Softness is encoded directly in the bezier curves. The rounding isn't
decorative; it's part of the pack's personality. A "sharp" chevron here still has subtle
bezier softening on the point.

### Abstraction level
Simplified to the essential form. Ask: "what is the minimum set of features to make this
instantly recognizable?" Keep those, drop everything else.

- A lock = shackle + body + keyhole dot. No screws, no brand, no chain.
- A brain = characteristic folded silhouette. Not anatomically precise.
- A note = rectangle + folded corner + two text lines. Not a full document.

If you can add a detail and the icon still reads without it, remove the detail.

### Negative space
The inner cutout (the "hole" inside a ring, envelope, lock body) is generous — roughly
matching the line weight visually. Don't make cutouts too small or the icon will read as
a filled blob at small sizes. Don't make them too large or the icon will look flimsy.

At 16–20px rendered size the icon must still be clearly readable. This is the primary
constraint on how much detail is acceptable.

---

## Constructing shapes

### The outline shape
Most icons are a single closed outline: draw the outer edge, then cut the inner area with
an evenodd subpath. The outer and inner shapes together describe the "wall" of the icon.

```
outer boundary  →  clockwise winding
inner cutout    →  counter-clockwise winding
fill-rule: evenodd  →  the overlap becomes transparent
```

### Accent marks (solid details)
Small filled shapes — dots, tiny circles, small solid polygons — are **separate paths**
drawn without evenodd. They sit on top of the outline shape and create focal points:
the dot in a lock's keyhole, eyes in a bot face, the info dot above an "i" line.

Rules for accent marks:
- Keep them simple: circle, small teardrop, simple polygon
- They should feel like the same weight family — not a dot so small it disappears, not
  so large it dominates
- One to three per icon max. More than that and it becomes illustration, not icon.

### Interior lines (text lines, dividers)
Lines drawn inside an icon (e.g. text lines on a document, grid lines on a table) use the
same ~1.33px weight. They follow the same filled-path logic — each line is a thin filled
rectangle with rounded ends, not a stroked line.

Typical proportion: interior lines occupy ~60–70% of the available inner width, centered.

---

## Icon categories and composition patterns

### Simple utility icons (chevrons, arrows, plus, check)
Single path. Pure geometry. Symmetrical or with clear directional intent. No inner cutouts.
Use 16×16 grid for purely directional icons (ChevronRight, ArrowTopRight), 20×20 for
the rest.

### Object icons (lock, mail, book, flag, note)
One evenodd outline path + zero to two accent detail paths. The object is centered with
~1.67px breathing room from all edges. Characteristic silhouette must be preserved.

### Compound icons (bot, database+cog, editlines, pictures+star)
Three to five paths. Primary object slightly repositioned to make room for the secondary
badge element. The badge (star, cog, plus) uses the **same line weight** and sits at
top-right or bottom-right of the primary shape. Never overlap both elements fully.

Pattern: primary icon shifts left/down by ~15–20% of the canvas; badge occupies the
freed corner at roughly 40–50% the size of the primary.

### Container icons (Circle/, Square/, Hexagon/)
A geometric frame (ring, rounded square, hexagon) wrapping a smaller inner symbol.
The frame is the evenodd ring; the inner symbol is independent paths at reduced scale
(~50–60% of the full canvas). The frame uses the same line weight as all other icons.

### Filled variants (StarFilled, PlayFilled)
The outline variant with the inner cutout removed — just the solid outer silhouette.
No additional detail or texture. If an outline icon uses evenodd to create holes,
the filled version simply omits the inner counter-clockwise subpath.

---

## What this pack is not

- **Not a duotone pack.** Every path uses the same `currentColor`. No two-color layering.
- **Not a rounded/bubbly pack.** Corners are soft but the overall geometry is constructed
  and precise — closer to geometric sans-serif than to a playful rounded style.
- **Not an illustrative pack.** Icons communicate function, not story. No unnecessary
  perspective, shadows, gradients, or decorative strokes.
- **Not a filled/solid pack by default.** The base variant is always outline. Filled is
  an explicit variant when provided.

---

## Quick reference — proportions (20×20 grid)

| Property | Value |
|---|---|
| Canvas | 20 × 20 |
| Edge padding | ~1.67 u |
| Line weight (effective) | ~1.33 u |
| Corner radius feel | subtle — equivalent to ~2–3px at 20px |
| Accent dot size (radius) | ~0.65–1.25 u |
| Badge size (relative to primary) | ~40–50% |

---

## File structure (technical minimum)

```vue
<script setup>
  defineProps({ size: { type: String, default: '1.5em' } });
</script>
<template>
  <svg xmlns="http://www.w3.org/2000/svg"
       :style="`width: ${size}; height: ${size};`"
       fill="currentColor"
       viewBox="0 0 20 20">
    <path d="..."/>
  </svg>
</template>
<style scoped></style>
```

Rules: only `<path>` elements inside SVG, no `stroke` attributes, no hardcoded colors,
`<style scoped>` always empty. The only prop is `size`.

One exception in the existing pack: `Stars1.vue` uses `stroke` — this is intentional
for that specific decorative shape and should not be used as a template for new icons.
