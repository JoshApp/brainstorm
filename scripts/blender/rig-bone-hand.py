"""Turn Tripo's 74 loose shells into a named, pivoted, parented right hand, and export it.

Run inside Blender (the MCP add-on execs this file). Deterministic and idempotent: it wipes and
re-imports, so it can be re-run after a mistake rather than patched.

Two things this script refuses to assume, because both bit me:

  · THE UP AXIS. An earlier scene had the arm along +Y; a fresh glTF import puts it along +Z,
    because the importer parents everything to a `ParentNode` holding the Y-up -> Z-up
    conversion. So the limb axis is DERIVED (small bones = hand, big bones = arm, the vector
    between them is the limb) and every band is a distance along it.
  · THAT `location` IS WORLD SPACE. It is parent space, and under that rotated ParentNode a
    world-space delta added to it moves the mesh. The first attempt slid `radius` by 7.7cm that
    way. Origins here move via matrix_world, and the geometry drift is ASSERTED at the end
    rather than eyeballed.

Bands are cut at measured gaps in the bone ladder, not at magic numbers:
  arm 4 · carpals 8 · metacarpals 5 · phalanges 14  = 31 right-side bones.
"""
import json
import os

import bpy
from mathutils import Vector, Matrix, Quaternion

SRC = r'C:\Users\josho\Downloads\skeleton+forearms+3d+model+seperate.glb'
# The share name is the DISTRO name, `Ubuntu-24.04` -- a bare `Ubuntu` resolves to nothing.
OUT = (r'\\wsl.localhost\Ubuntu-24.04\home\josh\brainstorm\.claude\worktrees'
       r'\viewmodel-v3\public\models\bone-hand-right.glb')

# The authored hand's frame, emitted from content/hand.ts by scripts/hand-frame.ts.
FRAME = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hand-frame.json')

FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky']
N_CARPAL, N_META, N_PHAL = 8, 5, 14
MIN_TRIS = 10                                  # below this it is import scrap, not a bone

# -- WIPE + IMPORT --------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
for block in (bpy.data.meshes, bpy.data.objects, bpy.data.materials):
    for b in list(block):
        if b.users == 0:
            block.remove(b)

bpy.ops.import_scene.gltf(filepath=SRC)
bpy.context.view_layer.update()


def verts(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]


def centroid(o):
    if o.type != 'MESH':
        return o.matrix_world.translation.copy()
    p = verts(o)
    return sum(p, Vector()) / len(p)


parts = []
for o in bpy.data.objects:
    if o.type != 'MESH' or not len(o.data.vertices):
        continue
    p = verts(o)
    parts.append({'o': o, 'c': sum(p, Vector()) / len(p), 'tris': len(o.data.polygons),
                  'lo': Vector((min(v.x for v in p), min(v.y for v in p), min(v.z for v in p))),
                  'hi': Vector((max(v.x for v in p), max(v.y for v in p), max(v.z for v in p)))})

# -- SIDE + SCRAP ---------------------------------------------------------
# The two arms are mirrored about x=0, which holds in any of the up-axis conventions above.
right = []
for p in parts:
    if p['tris'] < MIN_TRIS:
        p['o'].name = 'scrap_' + p['o'].name
    elif p['c'].x <= 0:
        p['o'].name = 'LEFT_' + p['o'].name
    else:
        right.append(p)

# -- THE LIMB AXIS, DERIVED -----------------------------------------------
by_size = sorted(right, key=lambda p: p['tris'])
hand_c = sum((p['c'] for p in by_size[:20]), Vector()) / 20
arm_c = sum((p['c'] for p in by_size[-4:]), Vector()) / 4
AXIS = (hand_c - arm_c).normalized()
for p in right:
    p['t'] = (p['c'] - arm_c).dot(AXIS)

ladder = sorted(right, key=lambda p: p['t'])
n_arm = len(ladder) - (N_CARPAL + N_META + N_PHAL)
arm, carp, meta, phal = (ladder[:n_arm],
                         ladder[n_arm:n_arm + N_CARPAL],
                         ladder[n_arm + N_CARPAL:n_arm + N_CARPAL + N_META],
                         ladder[n_arm + N_CARPAL + N_META:])

# Each band must be separated by a real gap; if the model ever changes, fail loudly here rather
# than silently name a carpal "thumb".
gaps = []
for a, b in ((arm, carp), (carp, meta), (meta, phal)):
    gaps.append(round(b[0]['t'] - a[-1]['t'], 3))
assert min(gaps) > 0.02, 'bands are not separated: {}'.format(gaps)

# -- ARM ------------------------------------------------------------------
arm[0]['o'].name = 'humerus'
rest = arm[1:]
elbow = min(rest, key=lambda p: (p['hi'] - p['lo']).length)     # a cap, not a shaft
elbow['o'].name = 'elbow'
fore = sorted([p for p in rest if p is not elbow], key=lambda p: p['c'].x)
fore[0]['o'].name = 'radius'                                     # thumb-side (low x)
fore[1]['o'].name = 'ulna'

for i, p in enumerate(carp):
    p['o'].name = 'palm_carpal_{}'.format(i + 1)

# -- FINGERS, GROWN AS CHAINS --------------------------------------------
# Take the nearest unclaimed bone further out at every step. Matching phalanges to a per-finger
# mean instead scrambles ring and pinky, because fingers FAN outward -- a distal phalanx sits
# nearest the WRONG column's average. Nothing here forces the thumb to be short; it comes out
# with two bones because there are 14 phalanges for 15 slots, and that is the check below.
meta = sorted(meta, key=lambda p: p['c'].x)                      # thumb -> pinky across the hand
chains = {FINGERS[i]: [m] for i, m in enumerate(meta)}
claimed = set()
for _ in range(3):
    cand = []
    for f, ch in chains.items():
        if len(ch) - 1 >= 3:
            continue
        tip = ch[-1]
        for i, p in enumerate(phal):
            if i in claimed or p['t'] <= tip['t']:
                continue
            cand.append(((p['c'] - tip['c']).length, i, f))
    cand.sort(key=lambda c: c[0])
    taken = set()
    for _d, i, f in cand:
        if i in claimed or f in taken or len(chains[f]) - 1 >= 3:
            continue
        chains[f].append(phal[i])
        claimed.add(i)
        taken.add(f)

short = [f for f in FINGERS if len(chains[f]) - 1 == 2]
assert short == ['thumb'], 'the two-bone column should be the thumb, got {}'.format(short)
assert len(claimed) == N_PHAL, 'unclaimed phalanges: {}'.format(N_PHAL - len(claimed))

LEN = {f: len(chains[f]) - 1 for f in FINGERS}
for f in FINGERS:
    chains[f][0]['o'].name = 'palm_meta_' + f
    for k, p in enumerate(chains[f][1:]):
        p['o'].name = '{}_{}'.format(f, k + 1)

# -- ANCHORS WITH INTENT --------------------------------------------------
# THE BASE OF THE CARPUS, not its centre.
#
# The arm IK targets this point's world position (viewmodel.ts: handWristSlot.getWorldPosition),
# so it is where the forearm ENDS -- and a wrist at the centroid of the eight carpals buries
# half the carpus inside the forearm, which reads as the arm reaching up into the hand. Josh,
# looking at it: *"but it targets the middle of the wrist right? the anchor should be at the
# base of the wrist bones."*
#
# Same rule as the bone pivots: average the proximal 20% of the carpal vertices, so the anchor
# lands in the middle of the joint SURFACE rather than on whichever vertex sticks out furthest.
# The authored hand agrees -- its carpus sphere sits at y=+0.010 above a wrist slot at zero.
carp_pts = sorted((v for p in carp for v in verts(p['o'])),
                  key=lambda v: (v - arm_c).dot(AXIS))
wrist_pos = sum(carp_pts[:max(3, len(carp_pts) // 5)], Vector()) / max(3, len(carp_pts) // 5)
meta_c = [chains[f][0]['c'] for f in FINGERS]
palm_pos = sum(meta_c, Vector()) / len(meta_c)
tip = chains['middle'][-1]['c']

F = (tip - wrist_pos).normalized()             # distal, along the fingers
L = (meta_c[4] - meta_c[1]).normalized()       # index -> pinky, across the palm
N = L.cross(F).normalized()                    # RIGHT hand: the palm faces L x F
G = F.cross(N).normalized()                    # a held grip runs across the palm


def empty(name, pos, direction=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.empty_display_size = 0.03
    m = Matrix.Translation(pos)
    if direction is not None:
        m = m @ direction.to_track_quat('Y', 'Z').to_matrix().to_4x4()
    e.matrix_world = m
    return e


anchors = [empty('wrist', wrist_pos),
           empty('palm_anchor', palm_pos),
           empty('palm_up', palm_pos, N),      # local +Y = palm outward normal
           empty('grip_axis', palm_pos, G)]    # local +Y = along a held grip
bpy.context.view_layer.update()

# -- PIVOTS AT THE JOINTS -------------------------------------------------
parent_of = {'radius': 'humerus', 'ulna': 'radius', 'elbow': 'radius', 'wrist': 'radius',
             'palm_anchor': 'wrist', 'palm_up': 'wrist', 'grip_axis': 'wrist'}
for i in range(len(carp)):
    parent_of['palm_carpal_{}'.format(i + 1)] = 'wrist'
for f in FINGERS:
    parent_of['palm_meta_' + f] = 'wrist'
    for k in range(1, LEN[f] + 1):
        parent_of['{}_{}'.format(f, k)] = 'palm_meta_' + f if k == 1 else '{}_{}'.format(f, k - 1)

ORDER = (['radius', 'ulna', 'elbow'] + ['palm_meta_' + f for f in FINGERS]
         + ['{}_{}'.format(f, k) for f in FINGERS for k in range(1, LEN[f] + 1)])

before = {n: centroid(bpy.data.objects[n]).copy() for n in ORDER}
pivots = {}
for name in ORDER:
    o, p = bpy.data.objects[name], bpy.data.objects[parent_of[name]]
    # Anchor to the parent's PIVOT -- the joint above -- not to its centroid. A centroid sits
    # mid-shaft, and for the ulna that is nearer its far end, so the pivot lands distal and the
    # bone would swing from its tip.
    anchor = p.matrix_world.translation.copy()
    pts = sorted(verts(o), key=lambda v: (v - anchor).length)
    take = max(3, len(pts) // 5)
    target = sum(pts[:take], Vector()) / take        # middle of the joint, not a mesh spike
    mw = o.matrix_world.copy()
    local = mw.inverted() @ target
    o.data.transform(Matrix.Translation(-local))
    o.matrix_world = mw @ Matrix.Translation(local)  # world-correct even under ParentNode
    bpy.context.view_layer.update()
    pivots[name] = round((o.matrix_world.translation - arm_c).dot(AXIS), 3)

# The check the first attempt did not have: only the PIVOT may move, never the geometry.
drift = {n: (centroid(bpy.data.objects[n]) - before[n]).length for n in before}
worst = max(drift.items(), key=lambda kv: kv[1])
assert worst[1] < 1e-5, 'geometry moved: {} by {:.4f}'.format(worst[0], worst[1])

# -- BAKE INTO THE GAME'S HAND CONVENTION ---------------------------------
#
# The point of this step, and the reason the runtime has no fitting code left in it: the asset
# arrives ALREADY SHAPED LIKE A HAND THIS GAME CAN USE. content/hand.ts puts the wrist at the
# origin with the fingers up +Y, gives every joint a local +Y along its own bone, and curls a
# finger by making rotation.x more negative. Match all of that here, once, and the loader is a
# name lookup.
#
# The target frame is MEASURED from the real HAND_RIGHT by scripts/hand-frame.ts and read from
# JSON -- never retyped. A bake aimed at copied constants would drift silently the first time
# content/hand.ts moved, and nothing would fail.
frame = json.load(open(FRAME, encoding='utf-8'))


def ortho(fingers, across):
    """An orthonormal basis with the FINGER axis exact and `across` made perpendicular to it.

    Both hands are reduced by this same function, so the two frames are comparable and no sign
    is assumed anywhere -- handedness included, since `across` is derived from which knuckle is
    the index and which the pinky.
    """
    f = fingers.normalized()
    a = (across - f * across.dot(f)).normalized()
    n = a.cross(f)
    return Matrix((                     # columns = (across, fingers, normal)
        (a.x, f.x, n.x),
        (a.y, f.y, n.y),
        (a.z, f.z, n.z),
    ))


def pivot(name):
    return bpy.data.objects[name].matrix_world.translation.copy()


# The bone hand describes itself with the same three facts. Its MCP joints are the pivots the
# step above placed at the base of each proximal phalanx, which is exactly what the authored
# `finger_index` / `finger_middle` / `finger_pinky` slots are.
bone_wrist = pivot('wrist')
bone_mid = pivot('middle_1')
# `across` points AT THE THUMB on both sides -- see the note in scripts/hand-frame.ts. The
# authored hand's index/pinky labels are mirrored relative to anatomy, so aligning by them
# flips a real hand and puts its thumb across the palm. Measured, not guessed: the first bake
# did exactly that, landing the bone thumb at +0.089 against the authored -0.040.
B = ortho(bone_mid - bone_wrist, pivot('thumb_1') - bone_wrist)
A = ortho(Vector(frame['fingers']), Vector(frame['across']))

scale = frame['len'] / (bone_mid - bone_wrist).length
M = ((A @ B.transposed()).to_4x4()
     @ Matrix.Scale(scale, 4)
     @ Matrix.Translation(-bone_wrist))

KEEP = (['humerus', 'radius', 'ulna', 'elbow', 'wrist', 'palm_anchor', 'palm_up', 'grip_axis']
        + ['palm_carpal_{}'.format(i + 1) for i in range(len(carp))]
        + ['palm_meta_' + f for f in FINGERS]
        + ['{}_{}'.format(f, k) for f in FINGERS for k in range(1, LEN[f] + 1)])

# Unparent first: with everything flat in world space, applying M is one multiply per object and
# there is no parent frame left to get wrong -- the mistake that slid the radius earlier.
for n in KEEP:
    o = bpy.data.objects[n]
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = M @ mw
bpy.context.view_layer.update()

# Bake rotation + scale into the MESH DATA so every bone ends with an identity rotation and unit
# scale, carrying only its joint position. That is what makes `rotation.x -= curl` mean "bend
# this finger about the across-palm axis" at runtime instead of "about some baked-in diagonal".
# Empties keep their rotation -- for palm_up and grip_axis the rotation IS the payload.
for n in KEEP:
    o = bpy.data.objects[n]
    if o.type != 'MESH':
        continue
    mw = o.matrix_world.copy()
    o.data.transform(mw.to_3x3().to_4x4())
    o.matrix_world = Matrix.Translation(mw.translation)

# The wrist is the hand's root, so it defines the frame rather than sitting in one.
bpy.data.objects['wrist'].matrix_world = Matrix.Identity(4)

# palm_anchor and palm_up take the AUTHORED transforms verbatim rather than the ones derived
# from this mesh. palm_anchor is where a weapon's grip_anchor lands, so its orientation aims the
# blade, and the weapon pipeline is already tuned against those numbers -- a palm anchor a few
# degrees off its authored pose points a sword somewhere visibly wrong. The derived versions
# were only ever a stand-in for not having a real hand to copy.
for name, a in frame['anchors'].items():
    q = a['quat']                                   # three.js order (x, y, z, w)
    bpy.data.objects[name].matrix_world = (
        Matrix.Translation(Vector(a['pos']))
        @ Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4())
bpy.context.view_layer.update()

# -- RENAME TO THE AUTHORED SLOT NAMES ------------------------------------
# After this the GLB speaks content/hand.ts's vocabulary, so binding is a lookup and the
# JOINT_MAP the runtime used to carry is gone.
SLOT = {'thumb_1': 'finger_thumb', 'thumb_2': 'finger_thumb_ip'}
for f in ['index', 'middle', 'ring', 'pinky']:
    SLOT['{}_1'.format(f)] = 'finger_' + f
    SLOT['{}_2'.format(f)] = 'finger_{}_pip'.format(f)
    SLOT['{}_3'.format(f)] = 'finger_{}_dip'.format(f)

for old, new in SLOT.items():
    bpy.data.objects[old].name = new
parent_of = {SLOT.get(k, k): SLOT.get(v, v) for k, v in parent_of.items()}
KEEP = [SLOT.get(n, n) for n in KEEP]

# -- HIERARCHY ------------------------------------------------------------
# The wrist is the exported root and must stay parentless: a selected child under an unselected
# parent is a bad bet with the glTF exporter, and the whole point of the bake is that the wrist
# IS the hand's frame.
parent_of.pop('wrist', None)
for name, pname in parent_of.items():
    o, p = bpy.data.objects.get(name), bpy.data.objects.get(pname)
    if not o or not p:
        continue
    o.parent = p
    o.matrix_parent_inverse = p.matrix_world.inverted()
bpy.context.view_layer.update()

# -- EXPORT THE HAND ------------------------------------------------------
# The hand only: the viewmodel already draws an arm, and the forearm bones would need their own
# pose decision. They stay named in the scene for when that question is asked.
hand = [n for n in KEEP if n not in ('humerus', 'radius', 'ulna', 'elbow')]
bpy.ops.object.select_all(action='DESELECT')
for n in hand:
    bpy.data.objects[n].select_set(True)
bpy.context.view_layer.objects.active = bpy.data.objects['wrist']
# export_yup=FALSE, deliberately. The bake above already put this hand in the GAME's
# frame, which is Y-up; the exporter's default Z-up -> Y-up conversion would rotate it a
# second time and land the fingers along -Z. Verified: the first export did exactly that.
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
                          export_yup=False)

# -- VERIFY AGAINST THE TARGET --------------------------------------------
# Assert the bake actually hit the authored frame, rather than trusting the algebra.
mid, idx, pnk = pivot('finger_middle'), pivot('finger_index'), pivot('finger_pinky')
target_mid = Vector(frame['knuckles']['middle'])
checks = {
    'wrist_at_origin_mm': round(pivot('wrist').length * 1000, 4),
    'middle_knuckle': [round(v, 4) for v in mid],
    'target_middle': [round(v, 4) for v in target_mid],
    'knuckle_error_mm': round((mid - target_mid).length * 1000, 2),
    'thumb_offset_mm': round(
        (pivot('finger_thumb') - Vector(frame['knuckles']['thumb'])).length * 1000, 2),
    'knuckle_x_order': sorted(
        ['thumb', 'index', 'middle', 'ring', 'pinky'],
        key=lambda f: pivot('finger_' + f).x),
    'rotations_identity': all(
        max(abs(v) for v in bpy.data.objects[n].rotation_euler) < 1e-5
        for n in hand if bpy.data.objects[n].type == 'MESH'),
}

result = {
    'exported': OUT,
    'nodes': len(hand),
    'band_gaps': gaps,
    'finger_lengths': LEN,
    'max_geometry_drift': round(worst[1], 8),
    'scale_applied': round(scale, 4),
    'checks': checks,
}
