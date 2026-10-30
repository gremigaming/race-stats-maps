// Render the raster zoom pyramid for the live viewer from the SVG tiles.
//
//   node scripts/pyramid.mjs <track> [<track> ...] [--out pyramid] [--only i_j,i_j]
//
// Chromium draws every 100 m SVG tile (all layers but "over", in index.json order; the viewer draws "over" above the cars) at
// 4096 px, so the pyramid looks exactly like the SVGs in a browser. Output, all
// 1024 px WebP squares, world x right and z down:
//
//   pyramid/<track>/<z>/<x>_<y>.webp   z 0..4, tile size 400 / 2**z metres
//   pyramid/<track>/index.json         {px, levels, tile0, tiles: {z: [[x, y], ...]}}
//
// z 4 is 25 m per tile (about 2.4 cm per pixel); tile x covers world x
// x*size..(x+1)*size, same for y and world z.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PX = 1024, FULL = 4096, SRC = 100, LEVELS = 5, BG = "#0e1013", QUALITY = 0.82;

const args = process.argv.slice(2);
const opt = (name, def) => {
  const k = args.indexOf(name);
  return k < 0 ? def : args.splice(k, 2)[1];
};
const out = resolve(opt("--out", "pyramid"));
const only = opt("--only", "") // a few tiles for a quick look
  .split(",").filter(Boolean);
const tracks = args;
const index = JSON.parse(await readFile(join(ROOT, "index.json"), "utf8"));

// same-origin server, so the canvas that draws the SVGs stays readable
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    res.writeHead(200, { "content-type": req.url.endsWith(".svg") ? "image/svg+xml" : "text/html" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/README.md`);
// draws one SVG tile at 4096 px, then returns the z 4, 3 and 2 crops as WebP data URLs
await page.evaluate(({ PX, FULL, BG, QUALITY }) => {
  const full = Object.assign(document.createElement("canvas"), { width: FULL, height: FULL });
  const fctx = full.getContext("2d");
  const tile = Object.assign(document.createElement("canvas"), { width: PX, height: PX });
  const tctx = tile.getContext("2d");
  tctx.imageSmoothingQuality = "high";
  window.renderTile = async (srcs) => {
    const imgs = await Promise.all(srcs.map((s) => new Promise((ok, fail) => {
      const i = new Image(FULL, FULL);
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error(`cannot load ${s}`));
      i.src = s;
    })));
    fctx.fillStyle = BG;
    fctx.fillRect(0, 0, FULL, FULL);
    for (const i of imgs) fctx.drawImage(i, 0, 0, FULL, FULL);
    const res = {};
    for (const [z, k] of [[4, 4], [3, 2], [2, 1]]) {
      const step = FULL / k;
      for (let a = 0; a < k; a++)
        for (let b = 0; b < k; b++) {
          tctx.drawImage(full, a * step, b * step, step, step, 0, 0, PX, PX);
          res[`${z}/${a}_${b}`] = tile.toDataURL("image/webp", QUALITY);
        }
    }
    return res;
  };
  // z 1 and z 0: up to 2 x 2 or 4 x 4 z 2 tiles shrunk into one square
  window.mergeTiles = async (k, parts) => {
    tctx.fillStyle = BG;
    tctx.fillRect(0, 0, PX, PX);
    for (const p of parts) {
      const i = new Image();
      i.src = p.url;
      await i.decode();
      tctx.drawImage(i, (p.a * PX) / k, (p.b * PX) / k, PX / k, PX / k);
    }
    return tile.toDataURL("image/webp", QUALITY);
  };
}, { PX, FULL, BG, QUALITY });

const put = async (path, dataUrl) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
};

for (const track of tracks) {
  const meta = index[track];
  if (!meta) throw new Error(`unknown track ${track}`);
  const tiles = only.length ? meta.tiles.filter((t) => only.includes(`${t.i}_${t.j}`)) : meta.tiles;
  const done = Object.fromEntries([...Array(LEVELS).keys()].map((z) => [z, []]));
  const z2 = new Map();
  const t0 = Date.now();
  for (const [n, t] of tiles.entries()) {
    const srcs = meta.layers.filter((l) => t.files[l] && l !== "over").map((l) => `${base}/${track}/${t.files[l]}`);
    const res = await page.evaluate((s) => window.renderTile(s), srcs);
    for (const [key, url] of Object.entries(res)) {
      const [z, ab] = key.split("/");
      const [a, b] = ab.split("_").map(Number);
      const k = 2 ** (Number(z) - 2);
      const x = t.i * k + a, y = t.j * k + b;
      await put(join(out, track, z, `${x}_${y}.webp`), url);
      done[z].push([x, y]);
      if (z === "2") z2.set(`${t.i}_${t.j}`, { i: t.i, j: t.j, url });
    }
    if (n % 50 === 0) console.log(`${track}: ${n + 1}/${tiles.length} tiles, ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  for (const [z, k] of [[1, 2], [0, 4]]) {
    const groups = new Map();
    for (const { i, j, url } of z2.values()) {
      const x = Math.floor(i / k), y = Math.floor(j / k);
      if (!groups.has(`${x}_${y}`)) groups.set(`${x}_${y}`, { x, y, parts: [] });
      groups.get(`${x}_${y}`).parts.push({ a: i - x * k, b: j - y * k, url });
    }
    for (const { x, y, parts } of groups.values()) {
      await put(join(out, track, String(z), `${x}_${y}.webp`), await page.evaluate(([k, p]) => window.mergeTiles(k, p), [k, parts]));
      done[z].push([x, y]);
    }
  }
  await writeFile(join(out, track, "index.json"), JSON.stringify({ px: PX, levels: LEVELS, tile0: SRC * 4, tiles: done }));
  console.log(`${track}: ${tiles.length} tiles done in ${Math.round((Date.now() - t0) / 1000)} s`);
}
await browser.close();
server.close();
