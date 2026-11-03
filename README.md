# GreMi Gang Race Stats: track maps

Sharp SVG track maps for the [race stats site](https://gremigaming.github.io/race-stats/),
served at https://gremigaming.github.io/race-stats-maps/.

- `index.json`: one entry per track folder with `tile` (metres, 100), `layers`
  (drawn in order: ground, track, marks, kerbs, walls, objects) and `tiles`
  (`i`, `j`, `files` per layer). Tile `i_j` covers world x `i*tile..(i+1)*tile`
  and z `j*tile..(j+1)*tile`, x right and z down.
- `<track>/<i>_<j>.<layer>.svg`: one SVG per tile and layer, in world metres.
- `over` (Suzuka so far, listed after `objects`): everything above a road, to draw above the
  cars that pass under it. One `<g>` per structure with `data-kind` (`bridge`, `tunnel`,
  `gantry`, `tree`, `roof`) and `data-under` (game y in metres of its underside; a car
  below that height is under it). A bridge is drawn with the road it carries and is left
  out of `objects`. `<track>/over.json` lists the structures:
  `{id, kind, under, bbox: [x0, z0, x1, z1], length_m}` (metres of road beneath).

`scripts/fix_shore.py` removes the fake shore glow where water carries on across tile
edges; run it again after copying new SVGs from the racing PC.

The maps are our own renders of simplified outlines, made on the racing PC from
the F1 25 track data. No game files or textures are stored here.

The live viewer uses a raster zoom pyramid rendered from these SVGs by
`scripts/pyramid.mjs` (1024 px WebP tiles, z 0 = 400 m down to z 4 = 25 m per tile).
Run the `pyramid` workflow by hand after the SVGs change; it attaches one
`pyramid-<track>.tar` per track to the `pyramid` release, and the live server copies
them into Cloudflare R2. The pyramid is not stored in this repo.

## Mipmaps viewer

`tools/mipmaps-viewer/index.html` ([open](https://gremigaming.github.io/race-stats-maps/tools/mipmaps-viewer/))
is a drop-in viewer for the game's `.mipmaps` texture files (e.g.
`F1 25\environment_package\tracks\<track>\objects\textures`). Files never leave the browser.
Each file holds the larger mip levels of one texture, largest first: either one raw LZ4 block
per level, or the plain uncompressed chain. Pixels are BC1/BC3/BC4/BC5/BC7 blocks. Width,
height and format are not in the file (they live in the `.erp`), so the viewer picks them by
decoding the smallest level for each candidate and keeping the least blocky one; they can be
changed by hand. Maps with the same base name (`_d`, `_da`, `_dh`, `_n`, `_s`) are combined
into one material on a cube, sphere, plane or cylinder (`_dh` alpha raises the surface).

It also opens the game's `.erp` archives (e.g.
`F1 25\2025_asset_groups\environment_package\tracks\<track>\wep\<track>_common.erp`) and shows
the 3D models in them. An `.erp` (`ERPK` v3) is a resource table plus zstd-packed fragments; the
page carries its own zstd decoder. `GfxMeshRes` lists the vertex/index streams (`GfxBufferRes`,
float3 positions, half4 normals/tangents/UVs) and submeshes with material slots; the `.emb`
binding maps slots to `.material` files, which name the textures. The `.erp` holds the small mip
levels of each texture (`GfxSurfaceRes`, with format and size in its header); the matching
`.mipmaps` files hold the big ones and are used when dropped alongside.
