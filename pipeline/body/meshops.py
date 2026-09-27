"""Mesh helpers for the body build (numpy + bmesh). Our own code."""
import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def adjacency(bm):
    bm.verts.index_update()
    nbrs = [[] for _ in bm.verts]
    for e in bm.edges:
        a, b = e.verts[0].index, e.verts[1].index
        nbrs[a].append(b)
        nbrs[b].append(a)
    return nbrs


def mesh_adjacency(me):
    e = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get("vertices", e)
    return e.reshape(-1, 2)


def padded_neighbors(edges, n):
    """(n, k) neighbor table padded with the vertex itself, plus neighbor counts."""
    deg = np.bincount(edges.ravel(), minlength=n)
    k = int(deg.max())
    table = np.repeat(np.arange(n)[:, None], k, axis=1)
    fill = np.zeros(n, np.int64)
    for a, b in edges:
        table[a, fill[a]] = b
        fill[a] += 1
        table[b, fill[b]] = a
        fill[b] += 1
    return table, np.maximum(deg, 1)


def laplacian_smooth(P, table, deg, iters, lam=0.5, free=None):
    P = P.copy()
    for _ in range(iters):
        avg = P[table].sum(axis=1) - P * (table.shape[1] - deg)[:, None]
        avg /= deg[:, None]
        step = lam * (avg - P)
        if free is not None:
            step *= free[:, None]
        P += step
    return P


def rings(nbrs, seed, k):
    out = set(seed)
    front = set(seed)
    for _ in range(k):
        nxt = set()
        for i in front:
            nxt.update(nbrs[i])
        front = nxt - out
        out |= front
    return out


def taubin(bm, verts, iters=10, lam=0.5, mu=-0.53, strength=None):
    nbrs = adjacency(bm)
    verts = sorted(verts)
    P = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
    s = np.ones(len(verts)) if strength is None else np.array([strength[i] for i in verts])
    for _ in range(iters):
        for f in (lam, mu):
            D = np.array([P[nbrs[i]].mean(axis=0) - P[i] for i in verts])
            P[verts] += f * s[:, None] * D
    for i in verts:
        bm.verts[i].co = Vector(P[i])


def flatten_patch(bm, free, ring=4):
    """Replace a small bump by a quadric height field fitted to the surrounding ring."""
    nbrs = adjacency(bm)
    support = sorted(rings(nbrs, free, ring) - set(free))
    bm.normal_update()
    P = np.array([bm.verts[i].co[:] for i in support])
    c = P.mean(axis=0)
    n = np.mean([bm.verts[i].normal[:] for i in support], axis=0)
    n /= np.linalg.norm(n)
    t1 = np.cross(n, [0.0, 0.0, 1.0])
    t1 /= np.linalg.norm(t1)
    t2 = np.cross(n, t1)

    def local(Q):
        d = Q - c
        return d @ t1, d @ t2, d @ n

    x, y, z = local(P)
    A = np.stack([x * x, x * y, y * y, x, y, np.ones_like(x)], axis=1)
    coef, *_ = np.linalg.lstsq(A, z, rcond=None)
    F = np.array([bm.verts[i].co[:] for i in free])
    fx, fy, _ = local(F)
    fz = np.stack([fx * fx, fx * fy, fy * fy, fx, fy, np.ones_like(fx)], axis=1) @ coef
    for k, i in enumerate(free):
        bm.verts[i].co = Vector(c + fx[k] * t1 + fy[k] * t2 + fz[k] * n)


def vertex_normals(P, tris):
    fn = np.cross(P[tris[:, 1]] - P[tris[:, 0]], P[tris[:, 2]] - P[tris[:, 0]])
    N = np.zeros_like(P)
    for k in range(3):
        np.add.at(N, tris[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


def triangles(me):
    me.calc_loop_triangles()
    t = np.empty(len(me.loop_triangles) * 3, np.int64)
    me.loop_triangles.foreach_get("vertices", t)
    return t.reshape(-1, 3)


def get_co(me):
    a = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def set_co(me, P):
    me.vertices.foreach_set("co", np.asarray(P, np.float32).ravel())
    me.update()


def subdivide_partial(obj, lowres):
    """One Catmull-Clark level on `obj` except the faces in `lowres`, which keep their resolution.

    Blender's subdivision result lists original vertices first, then one point per edge, then one per face,
    with each face's subfaces contiguous. Low-res faces are rebuilt from their smoothed corners plus the
    edge points their subdivided neighbours use, so there are no T-junctions.
    """
    me = obj.data
    V0, E0 = len(me.vertices), len(me.edges)
    sides = []
    for p in me.polygons:
        sides.append([(me.loops[li].vertex_index, me.loops[li].edge_index) for li in p.loop_indices])
    edge_faces = {}
    for f, s in enumerate(sides):
        for _, e in s:
            edge_faces.setdefault(e, []).append(f)
    starts = np.concatenate([[0], np.cumsum([len(s) for s in sides])])

    mods = [(m, m.show_viewport) for m in obj.modifiers]
    for m, _ in mods:
        m.show_viewport = False
    sub = obj.modifiers.new("subdiv", "SUBSURF")
    sub.levels = 1
    sub.uv_smooth = "PRESERVE_BOUNDARIES"
    dg = bpy.context.evaluated_depsgraph_get()
    new = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    obj.modifiers.remove(sub)
    for m, vis in mods:
        m.show_viewport = vis
    if len(new.vertices) != V0 + E0 + len(sides):
        raise RuntimeError("unexpected subdivision layout")

    bm = bmesh.new()
    bm.from_mesh(new)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    verts = list(bm.verts)
    rebuild = []
    for f in sorted(lowres):
        uv = {}
        for sf in range(starts[f], starts[f + 1]):
            for loop in bm.faces[sf].loops:
                uv[loop.vert.index] = loop[uvl].uv.copy()
        ring = []
        for v, e in sides[f]:
            ring.append(v)
            if any(g not in lowres for g in edge_faces[e]):
                ring.append(V0 + e)
        rebuild.append((f, [(verts[i], uv[i]) for i in ring]))
    smooth = {f: bm.faces[starts[f]].smooth for f in lowres}
    mat = {f: bm.faces[starts[f]].material_index for f in lowres}
    dead = [verts[V0 + E0 + f] for f in lowres]
    dead += [verts[V0 + e] for e, fs in edge_faces.items() if all(g in lowres for g in fs)]
    bmesh.ops.delete(bm, geom=dead, context="VERTS")
    for f, ring in rebuild:
        # quads stay quads; rings with edge points become a fan from the first edge point (topological, so
        # every build triangulates identically and none of the fan triangles lies along one original edge)
        tris = [ring] if len(ring) <= 4 else _fan(ring, V0)
        for tri in tris:
            face = bm.faces.new([v for v, _ in tri])
            for loop, (_, uv) in zip(face.loops, tri):
                loop[uvl].uv = uv
            face.smooth = smooth[f]
            face.material_index = mat[f]
    bm.to_mesh(new)
    bm.free()
    old = obj.data
    obj.data = new
    new.name = old.name
    bpy.data.meshes.remove(old)
    return dict(before=V0, after=len(new.vertices), lowresFaces=len(lowres))


def _fan(ring, V0):
    k = next(i for i, (v, _) in enumerate(ring) if v.index >= V0)
    r = ring[k:] + ring[:k]
    return [(r[0], r[i], r[i + 1]) for i in range(1, len(r) - 1)]


def triangulate_fixed(obj):
    """Quads split along a fixed diagonal, so the index buffer depends on topology only."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="FIXED", ngon_method="EAR_CLIP")
    bm.to_mesh(obj.data)
    bm.free()


def subdivide_full(obj):
    return subdivide_partial(obj, set())


class SurfaceBind:
    """Closest-point binding of points onto a triangle mesh (barycentric), for weight and delta transfer."""

    def __init__(self, P, tris, Q):
        bvh = BVHTree.FromPolygons([tuple(p) for p in P], [tuple(t) for t in tris.tolist()])
        self.tri = np.empty(len(Q), np.int64)
        self.bary = np.empty((len(Q), 3))
        self.dist = np.empty(len(Q))
        for i, q in enumerate(Q):
            loc, _, ti, d = bvh.find_nearest(Vector(q))
            a, b, c = P[tris[ti]]
            self.tri[i] = ti
            self.bary[i] = barycentric(np.array(loc), a, b, c)
            self.dist[i] = d
        self.tris = tris

    def interp(self, values):
        corners = self.tris[self.tri]
        return np.einsum("nk,nk...->n...", self.bary, values[corners])


def barycentric(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-20:
        return np.array([1.0, 0.0, 0.0])
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    return np.clip(np.array([1 - v - w, v, w]), 0, 1) / max(1e-12, np.clip(np.array([1 - v - w, v, w]), 0, 1).sum())


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)
