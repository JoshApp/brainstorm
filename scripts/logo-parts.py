# Usage: python3 scripts/logo-parts.py src/assets/ui/delve-logo.webp src/assets/ui [preview-dir]
# Needs Pillow. Writes logo-rule.webp (the carved bar with the skull plate) and
# logo-skull.webp (the plate alone), used by the HUD depth meter, the descent
# screen and the boot bar (index.html).
# Cut the skull rule and the skull plate out of the DELVE logo, keying the
# logo's dark backing plate out by brightness (the bar and plate are lit
# bronze; the backing is near-black). The plate's own dark inside is kept.
import sys
from PIL import Image
src, outdir = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA')
W, H = im.size
px = im.load()
out = Image.new('RGBA', (W, H))
op = out.load()
# Skull plate: for each row, everything between the arch's own bright left
# and right edges (found, not guessed) is the plate and is kept whole.
def lum_at(x, y):
    r, g, b, a = px[x, y]
    return 0.3 * r + 0.59 * g + 0.11 * b
spans = {}
for y in range(364, 452):
    bright = [x for x in range(380, 472) if lum_at(x, y) > 80]
    if len(bright) >= 2 and bright[-1] - bright[0] >= 30:
        spans[y] = (bright[0], bright[-1])
def in_plate(x, y):
    s = spans.get(y)
    return bool(s) and s[0] <= x <= s[1]
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if y < 378 and not in_plate(x, y): continue          # letters and the plate above the bar
        lum = 0.3 * r + 0.59 * g + 0.11 * b
        k = max(0.0, min(1.0, (lum - 38) / 40))               # backing plate is ~10-30
        if in_plate(x, y): k = 1.0
        op[x, y] = (r, g, b, int(a * k))
rule = out.crop((85, 364, 770, 452))
skull = out.crop((386, 364, 466, 452))
rule.save(f'{outdir}/logo-rule.webp', 'WEBP', quality=92, method=6)
skull.save(f'{outdir}/logo-skull.webp', 'WEBP', quality=92, method=6)
for n, c in (('rule', rule), ('skull', skull)):
    for nm, col in (('dark', (16, 10, 7, 255)), ('mid', (90, 80, 70, 255))):
        bg = Image.new('RGBA', c.size, col); bg.alpha_composite(c)
        if len(sys.argv) > 3: bg.resize((c.width * 2, c.height * 2)).save(f'{sys.argv[3]}/view-{n}-{nm}.png')
print(rule.size, skull.size)
