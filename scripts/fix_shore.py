"""Drop the fake shoreline glow along tile cuts.

Each ground SVG draws its water as one blob that reaches 9 to 35 m past its own
100 m tile, and then draws the soft shore glow along that whole outline. Where the
water simply carries on into the next tile, that outline is a cut, not a shore, so
open water shows a faint glowing grid. A piece of outline is a cut when it lies
well inside a neighbouring tile's water; only real shoreline keeps its glow.

Where four tiles meet on open water, every blob stops short of the shared corner and
leaves a small hole; those corners get a patch of water.

    python3 scripts/fix_shore.py [track ...]      # in place, every track by default
"""

import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSIDE = 3.0  # m inside a neighbour's water before an outline piece counts as a cut
CORNER = 12.0  # m: patch size around an open-water corner, and the glow dropped there
SHORE = re.compile(r'(<path d=")([^"]*)(" fill="none" stroke="[^"]*" stroke-opacity="[^"]*" stroke-width="[^"]*" filter="url\(#shore\)")')
WATER = "#3b5866"
FILL = re.compile(r'<g filter="url\(#water\)">(?:<rect [^>]*/>)*<path d="([^"]*)"')
NUM = re.compile(r"(-?[\d.]+) (-?[\d.]+)")


def rings(d):
    out = []
    for sub in re.split(r"(?=M)", d):
        pts = [(float(a), float(b)) for a, b in NUM.findall(sub)]
        if len(pts) > 1:
            out.append((pts, sub.rstrip().endswith("Z")))
    return out


def in_poly(p, poly):
    """Even-odd, like the fill."""
    hit = False
    for pts, _ in poly:
        for (x1, z1), (x2, z2) in zip(pts, pts[1:] + pts[:1]):
            if (z1 > p[1]) != (z2 > p[1]) and p[0] < x1 + (p[1] - z1) * (x2 - x1) / (z2 - z1):
                hit = not hit
    return hit


def inside(p, polys):
    """True when p is well inside the water of any of polys."""
    return any(in_poly(p, poly) and edge_distance(p, poly) > INSIDE for poly in polys)


def edge_distance(p, poly):
    best = math.inf
    for pts, _ in poly:
        for (x1, z1), (x2, z2) in zip(pts, pts[1:] + pts[:1]):
            dx, dz = x2 - x1, z2 - z1
            t = max(0.0, min(1.0, ((p[0] - x1) * dx + (p[1] - z1) * dz) / (dx * dx + dz * dz or 1)))
            best = min(best, math.hypot(p[0] - x1 - t * dx, p[1] - z1 - t * dz))
    return best


def fix(svg, neighbours, corners=()):
    """neighbours: the water outlines (rings) of the tiles around this one; corners: the
    open-water corners of this tile, which get a patch and lose their glow."""
    def near_corner(p):
        return any(abs(p[0] - cx) < CORNER and abs(p[1] - cz) < CORNER for cx, cz in corners)

    def keep(m):
        runs = []
        for pts, closed in rings(m.group(2)):
            if closed:
                pts = pts + pts[:1]
            run = []
            for a, b in zip(pts, pts[1:]):
                mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                if not inside(mid, neighbours) and not near_corner(mid):
                    if not run:
                        run = [a]
                    run.append(b)
                elif run:
                    runs.append(run)
                    run = []
            if run:
                runs.append(run)
        d = " ".join("M" + " L".join(f"{x:g} {z:g}" for x, z in r) for r in runs)
        return m.group(1) + (d or "M0 0") + m.group(3)

    svg = SHORE.sub(keep, svg)
    svg = re.sub(r'(<g filter="url\(#water\)">)(?:<rect [^>]*/>)+', r"\1", svg)  # patches from an earlier run
    if corners:
        patch = "".join(f'<rect x="{cx - CORNER:g}" y="{cz - CORNER:g}" width="{2 * CORNER:g}" height="{2 * CORNER:g}" fill="{WATER}"/>'
                        for cx, cz in corners)
        svg = svg.replace('<g filter="url(#water)">', '<g filter="url(#water)">' + patch, 1)
    return svg


def open_corners(i, j, size, water):
    """Corners of tile (i, j) with water all round them in all four tiles that meet there."""
    out = []
    for a in (0, 1):
        for b in (0, 1):
            cx, cz = (i + a) * size, (j + b) * size
            probes = [((i + a - 1 + u, j + b - 1 + v), (cx + (2 * u - 1) * 1.5 * CORNER, cz + (2 * v - 1) * 1.5 * CORNER))
                      for u in (0, 1) for v in (0, 1)]
            if all(water.get(ij) and in_poly(p, water[ij]) for ij, p in probes):
                out.append((cx, cz))
    return out


def main():
    index = json.load(open(os.path.join(ROOT, "index.json")))
    for track in sys.argv[1:] or sorted(index):
        tiles = {(t["i"], t["j"]): os.path.join(ROOT, track, t["files"]["ground"])
                 for t in index[track]["tiles"] if "ground" in t["files"]}
        water = {}  # from the fill, which this never changes, so a second run does nothing
        for ij, path in tiles.items():
            m = FILL.search(open(path).read())
            water[ij] = rings(m.group(1)) if m else []
        changed = 0
        for (i, j), path in tiles.items():
            if not water[(i, j)]:
                continue
            around = [water[(i + a, j + b)] for a in (-1, 0, 1) for b in (-1, 0, 1)
                      if (a or b) and water.get((i + a, j + b))]
            svg = open(path).read()
            new = fix(svg, around, open_corners(i, j, index[track]["tile"], water))
            if new != svg:
                open(path, "w").write(new)
                changed += 1
        print(f"{track}: {changed} ground tiles changed", file=sys.stderr)


if __name__ == "__main__":
    main()
