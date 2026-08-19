"""Crop and magnify a region of a PNG, for looking closely at something small in a snap.

    python3 scripts/crop.py IN.png OUT.png X Y W H [ZOOM]
    python3 scripts/crop.py IN.png OUT.png --info

Dependency-free ON PURPOSE. Pillow needs a venv on this box (PEP 668) and node_modules is
symlinked to the main checkout, so anything installed there leaks into every other worktree.
PNG only needs zlib, which is stdlib, and nearest-neighbour zoom is what you want anyway when
the question is "where exactly did that vertex land".

Handles the 8-bit RGB/RGBA non-interlaced PNGs Playwright emits, which is all snap produces.
"""
import struct
import sys
import zlib

CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def read_png(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos, idat, meta, palette = 8, bytearray(), None, None
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if ctype == b'IHDR':
            w, h, depth, color, _comp, _filt, interlace = struct.unpack('>IIBBBBB', body)
            assert depth == 8, 'only 8-bit PNGs, got {}'.format(depth)
            assert interlace == 0, 'interlaced PNGs not supported'
            meta = (w, h, color)
        elif ctype == b'PLTE':
            palette = body
        elif ctype == b'IDAT':
            idat += body
        elif ctype == b'IEND':
            break
        pos += 12 + length

    w, h, color = meta
    nch = CHANNELS[color]
    raw = zlib.decompress(bytes(idat))
    stride = w * nch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        filt = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        # PNG per-scanline filters, undone in place.
        if filt == 1:
            for i in range(nch, stride):
                line[i] = (line[i] + line[i - nch]) & 0xFF
        elif filt == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filt == 3:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif filt == 4:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                c = prev[i - nch] if i >= nch else 0
                b = prev[i]
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line

    if color == 3:
        rgb = bytearray(w * h * 3)
        for i in range(w * h):
            rgb[i * 3:i * 3 + 3] = palette[out[i] * 3:out[i] * 3 + 3]
        return w, h, 3, rgb
    return w, h, nch, out


def write_png(path, w, h, nch, pix):
    color = {1: 0, 2: 4, 3: 2, 4: 6}[nch]
    raw = bytearray()
    stride = w * nch
    for y in range(h):
        raw.append(0)                                   # filter 0: none
        raw += pix[y * stride:(y + 1) * stride]

    def chunk(tag, body):
        return (struct.pack('>I', len(body)) + tag + body
                + struct.pack('>I', zlib.crc32(tag + body) & 0xFFFFFFFF))

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, color, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(bytes(raw), 6)))
        f.write(chunk(b'IEND', b''))


def main(argv):
    src, dst = argv[1], argv[2]
    w, h, nch, pix = read_png(src)
    if '--info' in argv:
        print('{}x{} channels={}'.format(w, h, nch))
        return
    x, y, cw, ch = (int(v) for v in argv[3:7])
    zoom = int(argv[7]) if len(argv) > 7 else 4
    x, y = max(0, min(x, w - 1)), max(0, min(y, h - 1))
    cw, ch = min(cw, w - x), min(ch, h - y)
    ow, oh = cw * zoom, ch * zoom
    out = bytearray(ow * oh * nch)
    for j in range(oh):
        sy = y + j // zoom
        row = sy * w * nch
        base = j * ow * nch
        for i in range(ow):
            sx = (x + i // zoom) * nch
            out[base + i * nch:base + (i + 1) * nch] = pix[row + sx:row + sx + nch]
    write_png(dst, ow, oh, nch, out)
    print('wrote {} ({}x{}, {}x zoom of {},{} {}x{})'.format(dst, ow, oh, zoom, x, y, cw, ch))


if __name__ == '__main__':
    main(sys.argv)
