"""Print a GLB's node tree, so a rig can be checked without opening Blender.

Reads the JSON chunk straight out of the container -- no dependencies, no loader, nothing that
could reinterpret the file differently from how the engine will.
"""
import json
import struct
import sys


def load(path):
    with open(path, 'rb') as f:
        magic, _version, _length = struct.unpack('<4sII', f.read(12))
        assert magic == b'glTF', 'not a GLB: {}'.format(magic)
        while True:
            head = f.read(8)
            if len(head) < 8:
                raise SystemExit('no JSON chunk found')
            clen, ctype = struct.unpack('<I4s', head)
            data = f.read(clen)
            if ctype.strip() == b'JSON':
                return json.loads(data)


def main(path):
    g = load(path)
    nodes = g.get('nodes', [])
    meshes = g.get('meshes', [])
    child_of = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    tris = 0
    for m in meshes:
        for p in m.get('primitives', []):
            acc = g['accessors'][p['indices']] if 'indices' in p else None
            tris += (acc['count'] // 3) if acc else 0

    def walk(i, depth):
        n = nodes[i]
        kind = 'mesh' if 'mesh' in n else 'node'
        bits = []
        if 'translation' in n:
            bits.append('t=[{}]'.format(', '.join('{:.3f}'.format(v) for v in n['translation'])))
        if 'rotation' in n:
            bits.append('r=[{}]'.format(', '.join('{:.3f}'.format(v) for v in n['rotation'])))
        print('{}{:<18} {:<5} {}'.format('  ' * depth, n.get('name', '?'), kind, '  '.join(bits)))
        for c in n.get('children', []):
            walk(c, depth + 1)

    # Vertex extents, straight off the POSITION accessors. Node translations can look perfectly
    # scaled while the geometry under them is not, and only this tells the two apart.
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for m in meshes:
        for p in m.get('primitives', []):
            acc = g['accessors'][p['attributes']['POSITION']]
            for i in range(3):
                lo[i] = min(lo[i], acc['min'][i])
                hi[i] = max(hi[i], acc['max'][i])
    print('nodes={}  meshes={}  triangles={}'.format(len(nodes), len(meshes), tris))
    print('vertex extent  min=[{}]  max=[{}]  size=[{}]'.format(
        ', '.join('{:.3f}'.format(v) for v in lo),
        ', '.join('{:.3f}'.format(v) for v in hi),
        ', '.join('{:.3f}'.format(hi[i] - lo[i]) for i in range(3))))
    print('-' * 60)
    for i in range(len(nodes)):
        if i not in child_of:
            walk(i, 0)


if __name__ == '__main__':
    main(sys.argv[1])
