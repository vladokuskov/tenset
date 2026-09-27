"""Per-vertex data in COLOR_0: r = ambient occlusion, g = hair tint (brows, hairline fade), b = DQS mix. Our own code."""
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from meshops import get_co, smoothstep, triangles, vertex_normals


def _color(obj):
    me = obj.data
    attr = me.color_attributes.get("Col")
    if attr is None:
        attr = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
        init = np.zeros((len(me.vertices), 4), np.float32)
        init[:, 0] = init[:, 3] = 1
        attr.data.foreach_set("color", init.ravel())
    me.color_attributes.active_color = attr
    return attr


def set_channel(obj, ch, values):
    attr = _color(obj)
    cols = _read(attr, len(obj.data.vertices))
    cols[:, ch] = values
    attr.data.foreach_set("color", cols.ravel())


def _read(attr, n):
    c = np.empty(n * 4, np.float32)
    attr.data.foreach_get("color", c)
    return c.reshape(-1, 4)


def write_colors(body, frame, variant):
    me = body.data
    P = get_co(me)
    N = vertex_normals(P, triangles(me))
    brow = frame.brow(P, N) * (0.85 if variant == "a" else 0.7)
    depth, clear, _, _ = frame.hair(P)
    fade = smoothstep(-5.0, 0.0, depth) * (clear > 0) * 0.7
    set_channel(body, 1, np.maximum(brow, fade))


def bake_ao(obj, occluders, samples=32, max_dist=0.09):
    Ps, Ts, off = [], [], 0
    for o in occluders:
        P = get_co(o.data)
        Ps.append(P)
        Ts.append(triangles(o.data) + off)
        off += len(P)
    bvh = BVHTree.FromPolygons([tuple(p) for p in np.concatenate(Ps)], [tuple(t) for t in np.concatenate(Ts).tolist()])
    P = get_co(obj.data)
    N = vertex_normals(P, triangles(obj.data))
    rng = np.random.default_rng(7)
    u = rng.random((samples, 2))
    r = np.sqrt(u[:, 0])
    th = 2 * np.pi * u[:, 1]
    local = np.stack([r * np.cos(th), r * np.sin(th), np.sqrt(1 - u[:, 0])], axis=1)
    ao = np.ones(len(P), np.float32)
    for i in range(len(P)):
        n = Vector(N[i])
        t = n.orthogonal().normalized()
        b = n.cross(t)
        origin = Vector(P[i]) + n * 1e-3
        occ = 0.0
        for lx, ly, lz in local:
            hit = bvh.ray_cast(origin, t * lx + b * ly + n * lz, max_dist)
            if hit[0] is not None:
                occ += 1.0 - (hit[3] / max_dist) ** 0.5
        ao[i] = 1.0 - occ / samples
    set_channel(obj, 0, ao)
    return dict(min=float(ao.min()), mean=float(ao.mean()))
