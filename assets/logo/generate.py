"""Generate the Zeolite logo: a rough, raw crystal (like uncut fluorite).

An irregular, chipped outline around a hexagonal habit, cut into uneven
planes that meet at two ridge points, shaded from a top-left light in
translucent mint-green, with a few faint inner fractures.
Run: python3 generate.py
"""
import math

C = 256
LIGHT = 225  # degrees, SVG coordinates (y down): top-left

# Mint/seafoam ramp from shadow to highlight.
RAMP = ["#165E52", "#1F7466", "#2A8C7B", "#3AA690", "#52BFA5", "#72D3B9", "#96E3CB", "#BAF0DC", "#DDFAEE"]

# Outline: angle (deg), radius. Irregular hexagonal habit with chipped corners.
OUTLINE = [
    (-96, 222), (-78, 214), (-38, 206), (-24, 220), (18, 214), (34, 196),
    (78, 218), (96, 206), (142, 222), (158, 200), (202, 214), (218, 222),
]
# Ridge points where the planes meet (offset from the centre like a real stone).
RIDGES = [(-28, 0.0), (205, 62), (40, 74)]  # (angle, radius) — first is the centre


def pt(a, r):
    a = math.radians(a)
    return (C + r * math.cos(a), C + r * math.sin(a))


outer = [pt(a, r) for a, r in OUTLINE]
ridges = [pt(a, r) for a, r in RIDGES]


def fmt(points):
    return " ".join(f"{x:.1f},{y:.1f}" for x, y in points)


def shade(pts, tilt):
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    ang = math.degrees(math.atan2(cy - C, cx - C))
    b = 0.55 + 0.36 * tilt * math.cos(math.radians(ang - LIGHT))
    return RAMP[max(0, min(len(RAMP) - 1, round(b * (len(RAMP) - 1))))]


def nearest(p):
    return min(range(len(ridges)), key=lambda i: (ridges[i][0] - p[0]) ** 2 + (ridges[i][1] - p[1]) ** 2)


facets = []
n = len(outer)
owner = [nearest(((outer[i][0] + outer[(i + 1) % n][0]) / 2, (outer[i][1] + outer[(i + 1) % n][1]) / 2)) for i in range(n)]
for i in range(n):
    a, b = outer[i], outer[(i + 1) % n]
    r = ridges[owner[i]]
    tilt = 1.0 if (i % 3) else 0.75  # vary plane steepness for a rougher look
    facets.append(([a, b, r], tilt))
    nxt = owner[(i + 1) % n]
    if nxt != owner[i]:
        facets.append(([b, ridges[nxt], r], 0.6))
# Planes between the ridge points.
facets.append((ridges, 0.35))

fractures = [
    (pt(200, 120), pt(250, 40)),
    (pt(-60, 150), pt(-20, 90)),
    (pt(120, 150), pt(80, 120)),
]


def crystal(prefix):
    polys = "\n    ".join(
        f'<polygon points="{fmt(p)}" fill="{shade(p, t)}"/>' for p, t in facets
    )
    lines = "\n    ".join(
        f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>' for a, b in fractures
    )
    return f"""<defs>
    <clipPath id="{prefix}-clip"><polygon points="{fmt(outer)}"/></clipPath>
    <linearGradient id="{prefix}-sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.22"/>
      <stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#{prefix}-clip)">
    <g stroke="#F0FFF8" stroke-opacity="0.45" stroke-width="2.2" stroke-linejoin="round">
    {polys}
    </g>
    <g stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2" stroke-linecap="round">
    {lines}
    </g>
    <polygon points="{fmt(outer)}" fill="url(#{prefix}-sheen)"/>
  </g>
  <polygon points="{fmt(outer)}" fill="none" stroke="#0E4A40" stroke-opacity="0.5" stroke-width="5" stroke-linejoin="round"/>"""


icon = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Zeolite">
  <title>Zeolite</title>
  {crystal("zi")}
</svg>
"""

wordmark = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1160 360" width="1160" height="360" role="img" aria-label="Zeolite">
  <title>Zeolite</title>
  <g transform="translate(20 20) scale(0.625)">
  {crystal("zw")}
  </g>
  <text x="380" y="228" font-family="Inter, 'Segoe UI', Roboto, system-ui, sans-serif" font-size="150" font-weight="650" letter-spacing="-3" fill="#1F7466">Zeolite</text>
</svg>
"""

with open("zeolite-icon.svg", "w") as f:
    f.write(icon)
with open("zeolite-wordmark.svg", "w") as f:
    f.write(wordmark)
