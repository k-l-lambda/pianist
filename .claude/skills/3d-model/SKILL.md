---
name: 3d-model
description: Make 3D assets for the PianistWeb scenes from a reference image. Generated photos (seedream; image to image keeps variants consistent) become meshes by TRELLIS (a whole object with vertex colour, for furniture and ornaments) or MoGe-2 (single-view geometry, for reliefs and surfaces). The results are simplified, sized, split into materials and packed (gltf-transform, meshopt). Use when asked to model, generate or replace an object, ornament, relief, texture or sky for a scene, or to turn a reference picture into scene assets.
---

# 3D models from a reference image

**Start here:** read `doc.local.md` in this skill's folder. It is not committed. It gives this
machine's values for the placeholders below: `<venv-trellis>`, `<venv-depth>`, `<trellis-dir>`,
`<moge-src>`, `<moge-pt>`, `<generated>`, plus the API key's variable, the proxy and the GPU. If it
is missing, ask the user where TRELLIS, MoGe and the generated sources are.

All the tools are in `PianistWeb/tools/`. Run them from `PianistWeb/`, unless the command below
shows otherwise.

## The pipeline

1. **Reference**: the user's picture of the scene, for example a panorama of the room. Read off its
   layout, objects and materials. Close-ups give the detail for ornaments.
2. **Photos (seedream)**: one generated image per asset, kept outside the repo in `<generated>/`
   together with a `luminara.json` of the prompts.
   - The calls go through `generate( text, ref = null, size )` in `tools/bust-gen.mjs`, using model
     `seedream-5.0-lite`.
   - Generators: `tools/luminara-gen.mjs`, with an `ASSETS` table of `kind` (`object` | `relief` |
     `texture`), `prompt`, and optional `size` and `ref`. `tools/bust-gen.mjs` does the same for the
     hall's busts.
   - `node tools/luminara-gen.mjs --generated <generated> [--only a,b] [--force]`.
   - An existing image is kept, because each call is paid. `--force` makes a new one. Calls are
     spaced 3 s apart, and a failed call is retried once.
3. **3D**, by one of two methods (next section).
4. **Into the app**: `tools/luminara-asset.mjs` packs everything into `public/luminara/luminara.glb`.
   `node tools/luminara-asset.mjs --generated <generated> [--out file.glb]`.
5. **Look at it**: a quick point-splat preview of the mesh, then headless renders in the app
   (see the last section).

## TRELLIS or MoGe-2?

| Use | Method | Why |
|---|---|---|
| A free-standing object seen from several sides: furniture, an ornament, a plant's pot | **TRELLIS** (image to 3D, `TRELLIS-image-large`) | A closed mesh with vertex colour, about 1 min per object. Its faces are soft and lumpy, with no fine detail. |
| A relief on a wall, a bust seen from the front, a surface's shape (the bench's tufted top) | **MoGe-2** (`moge-2-vitl-normal`: point map and normals from one photo) | Sharp detail and normals from the photo's own view. It falls apart into strips when seen more than about 30° off that view: make a second photo turned to the viewer instead (`tools/bust-views.mjs`). |
| A flat glowing pattern, a sign, a glyph | neither: draw it (a font's outline, extruded: `tools/glyph-outlines.py`) | Generators misdraw symbols. |
| Something round and precise: a record, a drum table, a lathe profile | neither: build it procedurally in the scene code | Exact shape, its own UVs (anisotropy, textures). |

## Prompt patterns that worked

- **TRELLIS objects**: "Studio product photograph of a single …, the whole object in frame filling
  80 %, a three-quarter view from the front-left, camera slightly above, centred, plain pure white
  seamless background, soft even studio light, soft contact shadow only, nothing else in the
  image". TRELLIS takes the object's front as +z, so a three-quarter view still faces it the right way.
- **MoGe reliefs**: "seen exactly from the front, orthographic, centred, filling 85 %, soft even
  light from the front-left, gentle shading that shows the relief, plain neutral mid-grey seamless
  background". Busts: frontal, symmetric, on a small socle.
- **Image to image for variants**: give `ref: '<other slug>'` in `ASSETS`. The generator sends
  that slug's `-raw.jpg` as `image`, so the ref must already exist (put it earlier in `ASSETS`).
  Prompt: "The very same … as in the reference image, unchanged in its layout, at <hour>". The
  four window skies were made this way, so they show one city.
- **Panoramas that repeat** round a room (a sky cylinder with mirrored wrap): no single distinctive
  feature such as a moon. Each one shows up several times; a moon showed as two.
- **Textures**: "seamless tileable … seen straight from above, flat and evenly lit, no seams, no
  reflections". Then make it tile anyway: blend it with a copy shifted by half
  (`tileable()` in `luminara-asset.mjs`).
- Size: seedream wants at least **3.69 MP**. 3072×1024 is rejected; use 3840×1280 for a 3:1 sky
  and 2048×2048 for squares.

## TRELLIS: photo → mesh

`<venv-trellis>/bin/python PianistWeb/tools/luminara-3d.py <generated> --trellis <trellis-dir> [slug …] [--seed 1] [--force]`
(run from the repo root)

- Cut-out: the photo is resized to 1024² and cut out by **rembg** `u2net` (kept as `<slug>-rgba.png`:
  look at it, a white object on white can lose parts). TRELLIS would call rembg itself on an RGB
  image; giving it RGBA skips that.
- TRELLIS is loaded through `<trellis-dir>/trellis_load.py`, which skips the text pipeline (open3d)
  and the renderers' CUDA extensions, and replaces kaolin's `check_tensor` with a no-op (there are
  no kaolin wheels for this torch).
  - Formats: `mesh` only. The mesh decoder's FlexiCubes surface carries **vertex colour**
    (`vertex_attrs[:, :3]`); there is no texture without the gaussian decoder and nvdiffrast.
  - Its z-up output becomes y-up as in TRELLIS's `to_glb`: `v @ [[1,0,0],[0,0,-1],[0,1,0]]`.
  - Out: `<slug>-trellis.glb`, about 1 unit across, 0.3–1.4 M triangles. Stats go to `trellis-stats.json`.
- Its surfaces are **not wound one way**. Render them `DoubleSide`: culled, a chair's shell showed
  through to its cushion and looked like glass. A signed volume tells you nothing here.

## MoGe-2: photo → relief or surface

- `<venv-depth>/bin/python tools/bust-depth.py <photo> <out prefix> --moge <moge-src> --model <moge-pt> [--tokens 2500]`
  writes `<out>.npz`, with `points` (H, W, 3, camera space: x right, y down, z forward), `normal`
  and `mask` (the object against its backdrop), plus `-preview.png`.
- `<venv-depth>/bin/python tools/bust-relief.py <out>.npz <out prefix> [--height 0.55] [--rows 160]`
  builds the mesh on a grid over the mask. It is cut where the depth jumps, and its outline is swept
  back to a flat back. It writes `<out>.json` (base64 positions, uvs, indices) and an
  **object-space** normal map `-normal.png`. In three, use
  `normalMapType: ObjectSpaceNormalMap` with a uniform node scale only.
- To run many busts with the model loaded once: `tools/bust-batch.py --generated <dir> --moge <moge-src> --model <moge-pt>`.
- Surfaces, `tools/bench-top.py <photo> --moge <moge-src> --model <moge-pt> [--seed x,y] [--npz cache]`:
  1. Fit a plane by SVD and grow the region by distance to the plane and by normal angle.
  2. Resample onto the plane's frame.
  3. **Integrate the normals** (Frankot-Chellappa, mirrored so they are periodic). For shallow
     relief this is much cleaner than MoGe's depth.
  4. Take out the broad shape with a quadratic, then mirror and average with the object's own
     symmetry.
- A **glow mask** for a raised pattern: fit the panel's plane robustly (refit to the 60 % nearest,
  a few times), take the height in front of it, and smoothstep it. This was done for the old relief
  clef. A colour mask (its gold) gave only about 0.6 % coverage.

## Into the app (`tools/luminara-asset.mjs`)

- Per object:
  - **weld**, then **simplify** with meshopt (`simplifyPrimitive`, `ratio = TRIS[slug] / n`,
    `error 0.004`);
  - **size** it by one axis (`SIZE: [ 'x' | 'y', metres ]`): its base on y 0, centred in x and z.
- **Materials from the vertex colour**: `CLASSES[slug]` is a list of tests on a triangle's mean
  colour, its height and radius as fractions of the object's height. The first test that matches
  wins. For example brass is `r − b > 0.18`, a pot is "below 0.4 of the height", foliage is green.
  - Write the tests after measuring: print each part's `r − b` and brightness per height band,
    and its radius per height band (where a pot's rim ends, where a trunk is).
  - The vertex colour is kept only where the material wants it (`vertexColor`: foliage, books).
  - Brass is rarely in the colour you guess: a cream fabric is warm too.
- **Bases** (`BASE[slug]`): the brass band at the foot made `scale`× as high (everything above
  raised on it), then smoothed (Laplacian, a few passes) for a clean metal reflection, with its own
  material.
- Pack: `prune` (`keepAttributes`, `keepLeaves`: swatch nodes carry the textures), `reorder`,
  `quantize`, `EXTMeshoptCompression` (FILTER), WebP textures (`EXT_texture_webp`).
- The runtime (`src/luminara.js` `finish()`) replaces each pack material by its own, chosen by
  `extras.look`.

## Gotchas

- glTF images are **not flipped** (`flipY` false): v points down the image. To map a photo onto a
  cylinder, set `repeat.y` negative with an offset. A relief's UVs need `v = 1 − v` when packed.
- `quantize` **skips texcoords outside 0..1** (with a warning). Tiling UVs stay float; only UVs
  already in 0..1 are quantized.
- A canvas or `DataTexture` you build yourself (glyph maps): set `flipY` deliberately, and keep
  linear data (normal, anisotropy, masks) in `NoColorSpace`.
- An emissive map on TRELLIS output has no UVs to sit on. Detail without UVs (leather grain) has
  to be computed in the shader from object-space noise.
- An object with distinct parts (a record and its label, a stand) is better built procedurally
  than classified out of a TRELLIS blob.

## Checking quickly

- **Point-splat preview** of a `.glb` without the app: load it with trimesh and project the vertex
  colours orthographically from +z, +x, −z, −x and the top, shaded by the normal's z. Paste the
  views side by side; it shows whether the object faces +z and whether parts were lost.
- **In the app**: headless Chrome on the real GPU (see `doc.local.md`). Load the page, set
  `__pianist.camera`/`controls`, and take screenshots. Hide the HUD and GUI. Compare with
  `&nobake` (probe light) and with the bake.
- Put `<slug>-raw.jpg` and `<slug>-rgba.png` side by side before running TRELLIS: a bad cut-out
  means a bad mesh.
