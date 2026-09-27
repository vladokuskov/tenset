"""PNG -> WebP with Blender's bundled libwebp (quality 100 = lossless). Build-time tool only.

blender -b --factory-startup -P pipeline/atlas/webp.py -- in.png out.webp quality [in.png out.webp quality ...]
A loaded PNG keeps its own file type on save, so pixels are copied into a fresh image first.
Lossless outputs are decoded again and compared byte for byte.
"""
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
for i in range(0, len(args), 3):
    src, dst, quality = args[i], args[i + 1], int(args[i + 2])
    png = bpy.data.images.load(src)
    png.colorspace_settings.name = "Non-Color"
    w, h = png.size
    px = np.empty(w * h * 4, dtype=np.float32)
    png.pixels.foreach_get(px)
    img = bpy.data.images.new("webp", w, h, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(px)
    img.file_format = "WEBP"
    img.filepath_raw = dst
    img.save(filepath=dst, quality=quality)
    with open(dst, "rb") as f:
        head = f.read(16)
    kind = head[12:16].decode("latin1")
    if head[:4] != b"RIFF" or head[8:12] != b"WEBP" or kind not in ("VP8 ", "VP8L", "VP8X"):
        raise SystemExit(f"WEBP_FAIL not a WebP file: {dst}")
    if quality == 100:
        back = bpy.data.images.load(dst)
        back.colorspace_settings.name = "Non-Color"
        b = np.empty(w * h * 4, dtype=np.float32)
        back.pixels.foreach_get(b)
        if np.abs(np.round(px * 255) - np.round(b * 255))[np.arange(px.size) % 4 != 3].max() > 0:
            raise SystemExit(f"WEBP_FAIL lossless round trip differs: {dst}")
    print("WEBP_OK", dst, kind.strip())
