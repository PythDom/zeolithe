"""Generate the Zeolithe logo: a hexagonal cut gem seen from above.

Faceting follows a brilliant cut: a flat table in the middle, star facets
around it, and upper-girdle facets out to the girdle. Each facet is shaded
from its tilt direction against a light from the top left.
Run: python3 generate.py
"""
import math

C, R_OUT, R_TABLE = 256, 228, 100
LIGHT = 225  # degrees, SVG coordinates (y down): top-left

# Teal ramp from deep shadow to highlight.
RAMP = ["#06302F", "#0A4644", "#0E5E5A", "#0F7A73", "#0D9488", "#14B8A6", "#2DD4BF", "#5EEAD4", "#99F6E4", "#CCFBF1"]


def pt(r, a):
    a = math.radians(a)
    return (C + r * math.cos(a), C + r * math.sin(a))


def shade(cx, cy, tilt):
    """tilt 0 = flat, 1 = steep. Steeper facets swing further from mid-tone."""
    ang = math.degrees(math.atan2(cy - C, cx - C))
    b = 0.55 + 0.45 * tilt * math.cos(math.radians(ang - LIGHT))
    return RAMP[max(0, min(len(RAMP) - 1, round(b * (len(RAMP) - 1))))]


def fmt(points):
    return " ".join(f"{x:.1f},{y:.1f}" for x, y in points)


angles = [-90 + 60 * i for i in range(6)]  # pointy-top hexagon
outer = [pt(R_OUT, a) for a in angles]
table = [pt(R_TABLE, a) for a in angles]
mids = [pt(R_OUT * math.cos(math.radians(30)), a + 30) for a in angles]  # girdle edge midpoints

facets = []
for i in range(6):
    j = (i + 1) % 6
    for pts, tilt in (
        ([table[i], table[j], mids[i]], 0.75),   # star facet
        ([outer[i], table[i], mids[i]], 1.0),    # upper girdle facets
        ([mids[i], table[j], outer[j]], 1.0),
    ):
        cx = sum(p[0] for p in pts) / 3
        cy = sum(p[1] for p in pts) / 3
        facets.append(f'<polygon points="{fmt(pts)}" fill="{shade(cx, cy, tilt)}"/>')

glint = pt(R_TABLE * 0.55, LIGHT)


def gem(prefix):
    return f"""<defs>
    <linearGradient id="{prefix}-table" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#99F6E4"/>
      <stop offset="0.55" stop-color="#2DD4BF"/>
      <stop offset="1" stop-color="#0D9488"/>
    </linearGradient>
  </defs>
  <g stroke="#ECFEFF" stroke-opacity="0.35" stroke-width="2.5" stroke-linejoin="round">
    {chr(10).join('    ' + f for f in facets).strip()}
    <polygon points="{fmt(table)}" fill="url(#{prefix}-table)"/>
  </g>
  <polygon points="{fmt(outer)}" fill="none" stroke="#042F2E" stroke-opacity="0.45" stroke-width="5" stroke-linejoin="round"/>
  <path d="M{glint[0]:.1f} {glint[1] - 26:.1f} L{glint[0] + 6:.1f} {glint[1] - 6:.1f} L{glint[0] + 26:.1f} {glint[1]:.1f} L{glint[0] + 6:.1f} {glint[1] + 6:.1f} L{glint[0]:.1f} {glint[1] + 26:.1f} L{glint[0] - 6:.1f} {glint[1] + 6:.1f} L{glint[0] - 26:.1f} {glint[1]:.1f} L{glint[0] - 6:.1f} {glint[1] - 6:.1f} Z" fill="#FFFFFF" fill-opacity="0.9"/>"""


icon = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Zeolithe">
  <title>Zeolithe</title>
  {gem("zi")}
</svg>
"""

wordmark = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 360" width="1240" height="360" role="img" aria-label="Zeolithe">
  <title>Zeolithe</title>
  <g transform="translate(20 20) scale(0.625)">
  {gem("zw")}
  </g>
  <text x="380" y="228" font-family="Inter, 'Segoe UI', Roboto, system-ui, sans-serif" font-size="150" font-weight="650" letter-spacing="-3" fill="#0F6F69">Zeolithe</text>
</svg>
"""

with open("zeolithe-icon.svg", "w") as f:
    f.write(icon)
with open("zeolithe-wordmark.svg", "w") as f:
    f.write(wordmark)
