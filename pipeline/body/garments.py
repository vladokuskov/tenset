"""Procedural hair shell and athletic shorts. Our own code.

Hair: a close-fitting shell grown from the body's own scalp faces inside a hairline we define.
Shorts: cut from MPFB2's bundled CC0 `helper-tights` proxy surface, loosened towards the hem, skinned from the body.
"""
import bmesh
import bpy
import numpy as np
from mathutils import Vector

from meshops import SurfaceBind, get_co, laplacian_smooth, mesh_adjacency, padded_neighbors, set_co, smoothstep, triangles, vertex_normals
from skinning import set_weights, skin_arrays

HAIR_MIN = 0.0012


def extract_faces(obj, faces, name):
    """New object with only `faces` of obj (same parent, modifiers, groups, UVs); returns it and the source vertex ids."""
    me = obj.data
    attr = me.attributes.new("src", "INT", "POINT")
    attr.data.foreach_set("value", np.arange(len(me.vertices), dtype=np.int32))
    new = obj.copy()
    new.data = me.copy()
    new.name = new.data.name = name
    me.attributes.remove(me.attributes["src"])
    bpy.context.scene.collection.objects.link(new)
    bm = bmesh.new()
    bm.from_mesh(new.data)
    bm.faces.ensure_lookup_table()
    keep = set(faces)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(new.data)
    bm.free()
    src = np.empty(len(new.data.vertices), np.int32)
    new.data.attributes["src"].data.foreach_get("value", src)
    new.data.attributes.remove(new.data.attributes["src"])
    return new, src


def make_hair(body, frame):
    """Scalp faces inside the hairline, boundary snapped onto the hairline iso-line, offset along the normals."""
    me = body.data
    P = get_co(me)
    N = vertex_normals(P, triangles(me))
    depth, clear, az, el = frame.hair(P)
    k = frame.k
    f = np.minimum(depth / 6.0, clear / (0.008 * k))
    faces = [p.index for p in me.polygons if any(f[i] > 0 for i in p.vertices)]
    hair, src = extract_faces(body, faces, "hair")
    for m in list(hair.modifiers):
        if m.type != "ARMATURE":
            hair.modifiers.remove(m)
    fs, Ps, Ns = f[src], P[src], N[src]
    ring = [set() for _ in src]
    for p in hair.data.polygons:
        for i in p.vertices:
            ring[i].update(p.vertices)
    Pc, Nc = Ps.copy(), Ns.copy()
    for j in np.nonzero(fs <= 0)[0]:
        ins = [u for u in ring[j] if fs[u] > 0]
        t = np.array([fs[u] / (fs[u] - fs[j]) for u in ins])[:, None]
        Pc[j] = (Ps[ins] + (Ps[j] - Ps[ins]) * t).mean(0)
        Nc[j] = (Ns[ins] + (Ns[j] - Ns[ins]) * t).mean(0)
    Nc /= np.linalg.norm(Nc, axis=1, keepdims=True)
    a, e = az[src], el[src]
    top = smoothstep(15, 50, e)
    back = smoothstep(90, 160, a)
    tmax = (0.0030 + 0.0030 * top + 0.0010 * back * (1 - top)) * k
    t = HAIR_MIN + (tmax - HAIR_MIN) * smoothstep(0, 1.6, np.maximum(fs, 0))
    Q = Pc + Nc * t[:, None]
    edges = mesh_adjacency(hair.data)
    table, deg = padded_neighbors(edges, len(Q))
    bm = bmesh.new()
    bm.from_mesh(hair.data)
    free = np.array([0.0 if v.is_boundary else 1.0 for v in bm.verts])
    bm.free()
    for _ in range(3):
        Q = laplacian_smooth(Q, table, deg, 1, 0.5, free)
        Q = laplacian_smooth(Q, table, deg, 1, -0.53, free)
    set_co(hair.data, Q)
    return hair


def shorts_frame(rig, frame):
    B = rig.data.bones
    hip = np.array(B["upperleg01_L"].head_local)
    knee = np.array(B["lowerleg01_L"].head_local)
    thigh = hip[2] - knee[2]
    return dict(
        waist=hip[2] + 0.135 * frame.k,
        hem=hip[2] - 0.40 * thigh,
        legx=(hip[0] + knee[0]) / 2,
        thigh=thigh,
    )


def make_shorts(tights, body, rig, frame):
    names = {g.index: g.name for g in tights.vertex_groups}
    lower = ("root", "pelvis", "upperleg", "spine05", "spine04", "lowerleg")
    me = tights.data
    ok = np.zeros(len(me.vertices), bool)
    for v in me.vertices:
        s = sum(g.weight for g in v.groups if names.get(g.group, "").startswith(lower))
        ok[v.index] = s > 0.5
    sf = shorts_frame(rig, frame)
    P = get_co(me)
    ok &= P[:, 2] < sf["waist"] + 0.06
    ok &= P[:, 2] > sf["hem"] - 0.08
    faces = [p.index for p in me.polygons if all(ok[i] for i in p.vertices)]
    shorts, _ = extract_faces(tights, faces, "shorts")

    bm = bmesh.new()
    bm.from_mesh(shorts.data)
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, sf["waist"]), plane_no=(0, 0.12, 1), clear_outer=True)
    tilt = np.radians(5)
    for s in (1, -1):
        bm.verts.index_update()
        bm.edges.index_update()
        faces = [f for f in bm.faces if f.calc_center_median().x * s > 0]
        verts = sorted({v for f in faces for v in f.verts}, key=lambda v: v.index)
        edges = sorted({e for f in faces for e in f.edges}, key=lambda e: e.index)
        geom = verts + edges + faces
        bmesh.ops.bisect_plane(
            bm, geom=geom, plane_co=(s * sf["legx"], 0, sf["hem"]),
            plane_no=(s * np.sin(tilt), 0, -np.cos(tilt)), clear_outer=True,
        )
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    islands = _islands(bm)
    if len(islands) > 1:
        bmesh.ops.delete(bm, geom=[v for isl in islands[1:] for v in isl], context="VERTS")
    bm.to_mesh(shorts.data)
    bm.free()

    loosen(shorts, body, sf)
    hem(shorts, 0.006)
    fill_uvs(shorts)
    bind_weights(shorts, body)
    return shorts


def fill_uvs(obj, pad=0.01):
    """The tights proxy's UVs sit in a tiny corner of the MakeHuman atlas; scale them to fill the square."""
    uv = obj.data.uv_layers.active.data
    U = np.empty(len(uv) * 2, np.float32)
    uv.foreach_get("uv", U)
    U = U.reshape(-1, 2)
    lo, hi = U.min(0), U.max(0)
    U = pad + (U - lo) * ((1 - 2 * pad) / (hi - lo).max())
    uv.foreach_set("uv", U.ravel())


def _islands(bm):
    seen, out = set(), []
    for v in bm.verts:
        if v in seen:
            continue
        comp, stack = [], [v]
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            comp.append(x)
            stack.extend(e.other_vert(x) for e in x.link_edges)
        out.append(comp)
    return sorted(out, key=len, reverse=True)


def loosen(shorts, body, sf):
    """Offset from the skin: snug waistband, looser towards the hem; bridges the crotch and gluteal cleft."""
    bP = get_co(body.data)
    btris = triangles(body.data)
    me = shorts.data
    P = get_co(me)
    bind = SurfaceBind(bP, btris, P)
    bN = vertex_normals(bP, btris)
    foot = bind.interp(bP)
    n = bind.interp(bN)
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    u = np.clip((sf["waist"] - P[:, 2]) / (sf["waist"] - sf["hem"]), 0, 1)
    want = 0.005 + 0.009 * u ** 1.4
    side = ((P - foot) * n).sum(1)
    P = P + n * np.maximum(want - side, 0)[:, None]
    table, deg = padded_neighbors(mesh_adjacency(me), len(P))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    free = np.array([0.0 if v.is_boundary else 1.0 for v in bm.verts])
    loop = {v.index: [e.other_vert(v).index for e in v.link_edges if e.is_boundary] for v in bm.verts if v.is_boundary}
    bm.free()
    for _ in range(8):
        B = {i: P[n].mean(0) for i, n in loop.items() if len(n) == 2}
        for i, b in B.items():
            P[i] += 0.5 * (b - P[i])
    for _ in range(6):
        P = laplacian_smooth(P, table, deg, 1, 0.5, free)
        P = laplacian_smooth(P, table, deg, 1, -0.53, free)
    set_co(me, P)


def hem(shorts, depth):
    """Turn every open edge inwards so the waistband and leg openings show a fabric thickness."""
    me = shorts.data
    P = get_co(me)
    N = vertex_normals(P, triangles(me))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    orig = {v: v.index for v in bm.verts}
    edges = [e for e in bm.edges if e.is_boundary]
    ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
    new = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
    for v in new:
        i = next(orig[e.other_vert(v)] for e in v.link_edges if e.other_vert(v) in orig)
        v.co = Vector(P[i] - N[i] * depth)
    bm.to_mesh(me)
    bm.free()


def bind_weights(obj, body):
    names = [g.name for g in body.vertex_groups]
    idx, w = skin_arrays(body, names)
    W = np.zeros((len(idx), len(names)))
    np.put_along_axis(W, idx, w, axis=1)
    bind = SurfaceBind(get_co(body.data), triangles(body.data), get_co(obj.data))
    Wi = bind.interp(W)
    top = np.argsort(-Wi, axis=1)[:, :4]
    tw = np.take_along_axis(Wi, top, axis=1)
    tw /= tw.sum(1, keepdims=True)
    set_weights(obj, names, top, tw)
