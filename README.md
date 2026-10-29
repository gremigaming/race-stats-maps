# GreMi Gang Race Stats: track maps

Sharp SVG track maps for the [race stats site](https://gremigaming.github.io/race-stats/),
served at https://gremigaming.github.io/race-stats-maps/.

- `index.json`: one entry per track folder with `tile` (metres, 100), `layers`
  (drawn in order: ground, track, marks, kerbs, walls, objects) and `tiles`
  (`i`, `j`, `files` per layer). Tile `i_j` covers world x `i*tile..(i+1)*tile`
  and z `j*tile..(j+1)*tile`, x right and z down.
- `<track>/<i>_<j>.<layer>.svg`: one SVG per tile and layer, in world metres.

The maps are our own renders of simplified outlines, made on the racing PC from
the F1 25 track data. No game files or textures are stored here.

The live viewer uses a raster zoom pyramid rendered from these SVGs; that lives
in Cloudflare R2, not in this repo.
