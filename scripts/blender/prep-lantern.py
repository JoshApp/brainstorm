"""Prepare Josh's medieval lantern for the handheld lamp.

Run inside Blender (the MCP add-on execs this file). Deterministic and idempotent: wipes and
re-imports, so it can be re-run after a change rather than patched.

The lamp is not a rig, so this is a much smaller job than the hands — three facts have to be
true before the game can hang it off an arm:

  · IT MUST BE THE RIGHT SIZE. Tripo exports on a unit cube: 1.0 tall against a lantern that
    should be about a hand's length.
  · ITS ORIGIN MUST BE THE HANGING POINT. player/handheld-lamp.ts drives a `ringAnchor` that the
    off-hand's palm is solved onto, and lamp-arm.ts targets that anchor every frame. Origin the
    model at its BAIL and placing it becomes one assignment — the lantern hangs from the hook the
    way a real one does, instead of needing an offset nobody can check.
  · IT MUST BE ONE MESH. It arrives as 241 loose shells; joined, it is one draw.

WHERE THE BAIL IS, measured rather than assumed. Sliced along the model's own up axis, the
profile is unmistakable:

    z 0.00-0.40   radius ~0.20   body, lower
    z 0.45-0.72   radius ~0.20   body, upper
    z 0.75-1.00   radius ~0.05   the bail

The bail is the narrow top quarter, so it is found by taking everything above the point where the
silhouette collapses -- no hand-typed threshold, and it still holds if the model is re-exported
at a different proportion.

NOTE ON AXES: unlike scripts/blender/rig-bone-hand.py, this exports with the DEFAULT Y-up
conversion. That script bakes its hands into the game's own Y-up frame while Blender is Z-up, so
the conversion has to be switched off or it happens twice. Nothing here is pre-baked; the model
is handled in Blender's natural Z-up and converted once on the way out.
"""
import bpy
from mathutils import Matrix, Vector

SRC = r'C:\Users\josho\Downloads\medieval+lantern+3d+model.glb'
OUT = (r'\\wsl.localhost\Ubuntu-24.04\home\josh\brainstorm\.claude\worktrees'
       r'\viewmodel-v3\public\models\lantern.glb')

# How tall the lantern's BODY should be, metres — the part below the bail. The procedural lamp it
# replaces is a 0.10m cage between two plates, about 0.13 overall. Josh, on the first pass at
# 0.15: "can you make the lamp slightly bigger its a bit small" — then back down once the
# arm came off and the lantern sat lower in frame: "make the lamp a bit smaller again".
BODY_HEIGHT = 0.15

# -- WIPE + IMPORT --------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
for block in (bpy.data.meshes, bpy.data.objects, bpy.data.materials):
    for b in list(block):
        if b.users == 0:
            block.remove(b)

bpy.ops.import_scene.gltf(filepath=SRC)
bpy.context.view_layer.update()

meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices)]
assert meshes, 'nothing imported'

# -- ONE MESH -------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
lantern = bpy.context.view_layer.objects.active
lantern.name = 'lantern'
bpy.context.view_layer.update()

pts = [lantern.matrix_world @ v.co for v in lantern.data.vertices]
zlo = min(p.z for p in pts)
zhi = max(p.z for p in pts)


def radius_at(a, b):
    """Widest silhouette radius in the slice [a, b), about that slice's own centre."""
    sel = [p for p in pts if a <= p.z < b]
    if not sel:
        return 0.0
    cx = sum(p.x for p in sel) / len(sel)
    cy = sum(p.y for p in sel) / len(sel)
    return max(((p.x - cx) ** 2 + (p.y - cy) ** 2) ** 0.5 for p in sel)


# -- FIND THE BAIL --------------------------------------------------------
# Walk down from the top until the silhouette widens past a third of the body's own radius. That
# is where the bail meets the lantern, and it needs no typed-in height: the handle is narrow
# BECAUSE it is a handle.
N = 40
step = (zhi - zlo) / N
body_radius = max(radius_at(zlo + step * i, zlo + step * (i + 1)) for i in range(N // 2))
bail_floor = zhi
for i in range(N - 1, -1, -1):
    a = zlo + step * i
    # HALF the body's radius, not a third. The bail's own loop is ~0.09 wide against a 0.23
    # body, so a third (0.076) is inside the handle itself and the walk stopped at the loop
    # rather than at its base — it found the top 5% of the model instead of the top 25%.
    if radius_at(a, a + step) > body_radius / 2:
        bail_floor = a + step
        break
assert bail_floor < zhi, 'no bail found: the silhouette never narrows at the top'

bail = [p for p in pts if p.z >= bail_floor]

# ── THE ORIGIN IS THE BAIL'S TOP BAR, NOT THE LOOP'S CENTRE ──────────────
#
# You do not carry a lantern by the middle of its handle's hole — you hook your fingers over the
# BAR at the top of it. Origin the model there and the hand's grip point and the thing it grips
# are the same point, so the grip solver closes the fingers on the bar with nothing to reconcile.
# The loop's centre put the palm in mid-air inside the hole, which is what left the fingers
# sitting beside the handle instead of over it.
bar_floor = max(p.z for p in bail) - (max(p.z for p in bail) - bail_floor) * 0.25
bar = [p for p in bail if p.z >= bar_floor]
centre = sum(bar, Vector()) / len(bar)

# The bar's own thickness — what the fingers actually close around. Measured as the smaller
# horizontal spread of the bar's vertices, halved, because a handle is a wire and not a hilt.
bar_x = max(p.x for p in bar) - min(p.x for p in bar)
bar_y = max(p.y for p in bar) - min(p.y for p in bar)

# -- SCALE + RE-ORIGIN ----------------------------------------------------
scale = BODY_HEIGHT / (bail_floor - zlo)
# Origin lands on the bail's centre, so the runtime places the lantern by assigning one position.
M = Matrix.Scale(scale, 4) @ Matrix.Translation(-centre)
lantern.data.transform(M @ lantern.matrix_world)
lantern.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.update()

# -- EXPORT ---------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
lantern.select_set(True)
bpy.context.view_layer.objects.active = lantern
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True)

after = [lantern.matrix_world @ v.co for v in lantern.data.vertices]
result = {
    'exported': OUT,
    'tris': len(lantern.data.polygons),
    'scale': round(scale, 4),
    'bail_floor_frac': round((bail_floor - zlo) / (zhi - zlo), 3),
    'body_height_m': round((bail_floor - zlo) * scale, 4),
    # Everything below the origin is lantern; a little above it is the top of the bail.
    'span_below_origin_m': round(min(p.z for p in after), 4),
    'span_above_origin_m': round(max(p.z for p in after), 4),
    'width_m': round(max(p.x for p in after) - min(p.x for p in after), 4),
    # What the hand closes on. lamp-arm.ts needs this to solve the lantern grip.
    'bar_radius_m': round(min(bar_x, bar_y) * scale / 2, 4),
}
