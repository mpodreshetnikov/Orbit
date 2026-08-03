# Vendored body artwork — attribution

`male-front.ts` and `female-front.ts` are generated, not hand-written. The
silhouette outline and the muscle-group paths are derived from:

> **react-native-body-highlighter**
> https://github.com/HichamELBSI/react-native-body-highlighter
> Copyright (c) 2022 ELABBASSI Hicham — MIT License

The MIT licence text is reproduced at the end of this file, as its terms
require.

## Why vendored instead of installed

The upstream package targets React Native (`react-native-svg`), so it cannot be
rendered by this app. The React ports that do exist either drop the left/right
distinction we need for `bicep_left` vs `bicep_right`, or are too new and
thinly maintained to take as a runtime dependency in a health app. Taking the
path data and rendering it ourselves also lets us fill regions with this
project's CSS custom properties so the map works in dark mode.

## What was changed

- Only the **front** view is vendored. No measurement in
  `measurement_catalog` is back-only, so there is no back view.
- Upstream `left` / `right` are **viewer**-relative. On a front view the
  viewer's right is the person's _left_ limb, so our `*_left` region ids map to
  upstream's `right` arrays and vice versa. `regions.test.ts` locks this in by
  asserting `bicep_left` sits to the right of the body's centre line.
- Upstream slugs are collapsed to our measurement sites: `deltoids` →
  `shoulders`, `quadriceps` → `thigh_*`, `biceps` → `bicep_*`, `calves` →
  `calf_*`, `forearm` → `forearm_*`, plus `neck` and `chest` unchanged.
- `waist` and `hips` are **ours, not upstream's**. They are measurement sites
  rather than muscle groups, so no upstream path exists. They are authored as
  simple bulged bands and clipped to the silhouette at render time (see
  `BAND_REGIONS` in `../regions.ts` and the `<clipPath>` in `../body-map.tsx`),
  which keeps them exactly inside the body outline on both models.
- Anchor points are the centroid of each region's bounding box, with paired
  limbs forced to a shared `y` so left and right callouts line up.

## Regenerating

Nothing in the app reads from upstream at build or run time; regeneration is a
one-off manual step, only needed if the artwork itself should change.

1. `git clone --depth 1 https://github.com/HichamELBSI/react-native-body-highlighter`
2. Path data lives in `assets/bodyFront.ts` and `assets/bodyFemaleFront.ts` as
   `{ slug, color, path: { left, right, common } }` records. The silhouette is
   the first long `d="…"` attribute in `components/SvgMaleWrapper.tsx` /
   `components/SvgFemaleWrapper.tsx` (the second is the back view).
3. **Do not copy upstream's `viewBox`.** Those boxes carry a lot of empty
   space — the male silhouette starts 11.3% of the way down `0 0 724 1448`
   and the female 8.3% down `-50 -40 734 1538` — which renders as a gap
   between the side header and the head. Fit the box to the artwork instead:
   take the bounding box of the silhouette plus every region path, and pad it
   by 6 units on each side. Today that yields male `42 158 646 1201` and
   female `-6 82 655 1357`.
4. Apply the slug → region mapping and the viewer/anatomical side swap
   described above, then re-emit both files.

Nothing downstream needs adjusting when the box changes: anchors are stored
as absolute coordinates and converted through `parseViewBox`, so label
positions and the container's aspect ratio follow on their own.

Run `just test-unit-web` afterwards — `regions.test.ts` fails if any region
loses its paths or its anchor, if the side swap is reversed, or if the
`viewBox` reverts to upstream's padded one. Update the expected boxes in that
test when the artwork itself legitimately changes.

## Upstream licence

```
MIT License

Copyright (c) 2022 ELABBASSI Hicham

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
