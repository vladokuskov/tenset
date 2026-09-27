"""Build the CC0 athletic body with MPFB2 inside headless Blender.

blender -b --factory-startup -P pipeline/body/build_body.py -- --variant a --out body-a.raw.glb --report report-a.json

MPFB2 is used only as a tool (create_human, add_builtin_rig) plus its bundled CC0 assets (base mesh with
its helper geometry, targets, rig and weights). Everything after that is our own mesh processing.
"""
import argparse
import importlib
import json
import os
import sys

import addon_utils
import bmesh
import bpy
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from correctives import build_correctives  # noqa: E402
from garments import make_hair, make_shorts, shorts_frame  # noqa: E402
from head import HeadFrame, eye_uvs, stylize_face  # noqa: E402
from meshops import SurfaceBind, adjacency, flatten_patch, get_co, mesh_adjacency, padded_neighbors, rings, subdivide_full, subdivide_partial, taubin, triangles, triangulate_fixed  # noqa: E402
from shading import bake_ao, set_channel, write_colors  # noqa: E402
from skinning import dqs_mix  # noqa: E402

MPFB_MODULE = "bl_ext.user_default.mpfb"
MPFB_VERSION = "2.0.17"
RIG = "default_no_toes"

# lean, visibly muscular young adult male, average-tall
MACROS = dict(gender=1.0, age=0.5, muscle=1.0, weight=0.4, proportions=1.0, height=0.58)

# bundled CC0 modeling targets: athletic definition on top of the macros
TARGETS = [
    ("torso/torso-vshape-incr.target.gz", 0.5),
    ("torso/torso-muscle-pectoral-incr.target.gz", 0.6),
    ("torso/torso-muscle-dorsi-incr.target.gz", 0.6),
    ("stomach/stomach-pregnant-decr.target.gz", 0.5),
    ("stomach/stomach-tone-incr.target.gz", 0.8),
    ("pelvis/bulge-decr.target.gz", 0.8),
    ("neck/neck-scale-horiz-incr.target.gz", 0.3),
] + [
    (f"{part}/{s}-{name}.target.gz", w)
    for s in ("l", "r")
    for part, name, w in (
        ("arms", "upperarm-muscle-incr", 0.9),
        ("arms", "upperarm-shoulder-muscle-incr", 0.8),
        ("arms", "lowerarm-muscle-incr", 0.5),
        ("arms", "upperarm-fat-decr", 0.5),
        ("legs", "upperleg-muscle-incr", 0.8),
        ("legs", "lowerleg-muscle-incr", 0.6),
        ("legs", "upperleg-fat-decr", 0.5),
    )
]

# calm, relaxed lids for both heads
EXPRESSION = [
    ("expression/units/caucasian/eye-left-closure.target.gz", 0.18),
    ("expression/units/caucasian/eye-right-closure.target.gz", 0.18),
]

# stylized head (variant B): simpler, softer features from bundled CC0 targets, then smoothed in head.py
FACE_B = [
    ("nose/nose-volume-decr.target.gz", 0.5),
    ("nose/nose-nostrils-width-decr.target.gz", 0.6),
    ("nose/nose-flaring-decr.target.gz", 0.8),
    ("nose/nose-point-width-decr.target.gz", 0.5),
    ("nose/nose-scale-vert-decr.target.gz", 0.25),
    ("mouth/mouth-lowerlip-volume-decr.target.gz", 0.7),
    ("mouth/mouth-upperlip-volume-decr.target.gz", 0.7),
    ("mouth/mouth-cupidsbow-decr.target.gz", 0.8),
    ("mouth/mouth-scale-horiz-decr.target.gz", 0.25),
    ("chin/chin-prominent-decr.target.gz", 0.4),
] + [
    (f"{part}/{s}-{name}.target.gz", w)
    for s in ("l", "r")
    for part, name, w in (
        ("eyes", "eye-bag-decr", 1.0),
        ("eyes", "eye-scale-incr", 0.3),
        ("ears", "ear-flap-decr", 0.7),
        ("ears", "ear-scale-decr", 0.3),
        ("cheek", "cheek-bones-decr", 0.3),
    )
]

HAND_FOOT = ("finger", "metacarpal", "wrist", "foot", "toe")
LOWER_BODY = ("root", "pelvis", "upperleg", "spine05")
MERGE_INTO = {"breast.L": "spine02", "breast.R": "spine02"}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--variant", choices=("a", "b"), default="a")
    p.add_argument("--out", required=True)
    p.add_argument("--report")
    p.add_argument("--blend")
    p.add_argument("--no-correctives", action="store_true")
    return p.parse_args(argv)


def load_mpfb():
    addon_utils.enable(MPFB_MODULE, default_set=True)
    manifest = os.path.join(bpy.utils.user_resource("EXTENSIONS"), "user_default", "mpfb", "blender_manifest.toml")
    version = None
    with open(manifest) as f:
        for line in f:
            if line.startswith("version"):
                version = line.split("=")[1].strip().strip('"')
    if version != MPFB_VERSION:
        raise RuntimeError(f"MPFB2 {MPFB_VERSION} required, found {version}")

    def imp(pkg, key):
        for name in list(sys.modules):
            if name.endswith(pkg):
                return getattr(importlib.import_module(name), key)
        raise ImportError(pkg)

    return (
        imp("mpfb.services.humanservice", "HumanService"),
        imp("mpfb.services.targetservice", "TargetService"),
        imp("mpfb.services.locationservice", "LocationService"),
    )


def bake_shape_keys(obj):
    me = obj.data
    if not me.shape_keys:
        return
    n = len(me.vertices)
    kbs = me.shape_keys.key_blocks

    def co_of(kb):
        a = np.empty(n * 3, np.float32)
        kb.data.foreach_get("co", a)
        return a

    out = co_of(kbs[0])
    for kb in kbs[1:]:
        if kb.mute or kb.value == 0:
            continue
        out += kb.value * (co_of(kb) - co_of(kb.relative_key))
    obj.shape_key_clear()
    me.vertices.foreach_set("co", out)
    me.update()


def group_members(obj, names):
    idx = {obj.vertex_groups[n].index for n in names if n in obj.vertex_groups}
    return {v.index for v in obj.data.vertices if any(g.group in idx and g.weight > 0 for g in v.groups)}


def extract(obj, keep, name):
    """Copy of `obj` (same parent, modifiers and groups) holding only the vertices in `keep`."""
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = name
    new.data.name = name
    bpy.context.scene.collection.objects.link(new)
    bm = bmesh.new()
    bm.from_mesh(new.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context="VERTS")
    bm.to_mesh(new.data)
    bm.free()
    return new


def soften_hidden(obj):
    """Flatten the nipples to a clean surface."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    nipples = sorted(group_members(obj, ["nipple", "nippleTip"]))
    if nipples:
        nbrs = adjacency(bm)
        for side in (1, -1):
            patch = sorted(rings(nbrs, [i for i in nipples if bm.verts[i].co.x * side > 0], 2))
            flatten_patch(bm, patch)
        taubin(bm, rings(nbrs, nipples, 4), iters=8)
    bm.to_mesh(obj.data)
    bm.free()
    return dict(nippleVerts=len(nipples))


def face_bones(rig):
    out = []

    def walk(b):
        for c in b.children:
            out.append(c.name)
            walk(c)

    walk(rig.data.bones["head"])
    return out


def process_weights(obj, rig, dropped):
    """Fold dropped bones into their targets, drop non-bone groups, keep top 4, normalize."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    dl = bm.verts.layers.deform.verify()
    vg = obj.vertex_groups
    bone_names = {b.name for b in rig.data.bones} - set(dropped)
    into = {vg[n].index: vg[t].index for n, t in dropped.items() if n in vg and t in vg}
    keep = {g.index for g in vg if g.name in bone_names}
    for v in bm.verts:
        d = v[dl]
        acc = {}
        for g, w in d.items():
            g = into.get(g, g)
            if g in keep and w > 0:
                acc[g] = acc.get(g, 0.0) + w
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        s = sum(w for _, w in top) or 1.0
        d.clear()
        for g, w in top:
            if w / s > 1e-3:
                d[g] = w / s
    bm.to_mesh(obj.data)
    bm.free()


def smooth_regions(rig):
    """Weight-smoothing spheres (center, radius, strength) around the joints that bend hardest."""
    from mathutils import Vector

    B = rig.data.bones
    out = []
    for side in ("L", "R"):
        hip = B[f"upperleg01.{side}"].head_local
        out += [
            (hip, 0.16, 0.6),
            (hip + Vector((0, 0.07, -0.12)), 0.10, 0.5),
            (B[f"lowerleg01.{side}"].head_local, 0.09, 0.35),
            (B[f"upperarm01.{side}"].head_local, 0.17, 0.7),
            (B[f"upperarm01.{side}"].head_local + Vector((0, 0, -0.08)), 0.10, 0.6),
            (B[f"shoulder01.{side}"].head_local, 0.14, 0.6),
            (B[f"lowerarm01.{side}"].head_local, 0.07, 0.3),
        ]
    hl, hr = B["upperleg01.L"].head_local, B["upperleg01.R"].head_local
    out.append(((hl + hr) / 2 + Vector((0, 0, -0.06)), 0.10, 0.7))
    return out


def smooth_weights(obj, regions, iters=15):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    dl = bm.verts.layers.deform.verify()
    nbrs = adjacency(bm)
    groups = sorted({g for v in bm.verts for g in v[dl].keys()})
    col = {g: i for i, g in enumerate(groups)}
    W = np.zeros((len(bm.verts), len(groups)))
    for v in bm.verts:
        for g, w in v[dl].items():
            W[v.index, col[g]] = w
    P = np.array([v.co[:] for v in bm.verts])
    alpha = np.zeros(len(bm.verts))
    for c, r, a in regions:
        f = np.clip(1 - np.linalg.norm(P - np.array(c[:]), axis=1) / r, 0, 1)
        alpha = np.maximum(alpha, a * f * f * (3 - 2 * f))
    idx = np.nonzero(alpha > 0)[0]
    for _ in range(iters):
        M = np.array([W[nbrs[i]].mean(axis=0) for i in idx])
        W[idx] = (1 - alpha[idx, None]) * W[idx] + alpha[idx, None] * M
    for i in idx:
        row = W[i]
        top = np.argsort(-row)[:4]
        top = top[row[top] > 1e-3]
        d = bm.verts[i][dl]
        d.clear()
        s = row[top].sum()
        for k in top:
            d[groups[k]] = float(row[k] / s)
    bm.to_mesh(obj.data)
    bm.free()
    return len(idx)


def remove_bones(rig, names):
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig.data.edit_bones
    for n in names:
        if n in eb:
            eb.remove(eb[n])
    bpy.ops.object.mode_set(mode="OBJECT")


def rename_bones(rig, objs):
    for b in rig.data.bones:
        if "." in b.name:
            old = b.name
            b.name = old.replace(".", "_")
            for o in objs:
                if old in o.vertex_groups:
                    o.vertex_groups[old].name = b.name


def drop_foreign_groups(obj, rig):
    names = {b.name for b in rig.data.bones}
    for g in list(obj.vertex_groups):
        if g.name not in names:
            obj.vertex_groups.remove(g)


def lowres_faces(obj, rig, frame, ears):
    """Faces that skip subdivision: hands and feet (already dense), ears, and skin fully covered by the shorts."""
    names = {g.index: g.name for g in obj.vertex_groups}
    hf = {i for i, n in names.items() if n.startswith(HAND_FOOT)}
    low = {i for i, n in names.items() if n.startswith(LOWER_BODY)}
    share = np.zeros(len(obj.data.vertices))
    lower = np.zeros(len(obj.data.vertices))
    for v in obj.data.vertices:
        share[v.index] = sum(g.weight for g in v.groups if g.group in hf)
        lower[v.index] = sum(g.weight for g in v.groups if g.group in low)
    sf = shorts_frame(rig, frame)
    z = get_co(obj.data)[:, 2]
    covered = (lower > 0.5) & (z > sf["hem"] + 0.04) & (z < sf["waist"] - 0.04)
    keep = (share > 0.5) | covered
    keep[list(ears)] = True
    return {p.index for p in obj.data.polygons if all(keep[i] for i in p.vertices)}


def set_material(obj, name):
    obj.data.materials.clear()
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    obj.data.materials.append(mat)
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    obj.data.update()


def main():
    args = parse_args()
    HumanService, TargetService, LocationService = load_mpfb()
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)

    macro = TargetService.get_default_macro_info_dict()
    macro.update(MACROS)
    human = HumanService.create_human(macro_detail_dict=macro)
    tdir = LocationService.get_mpfb_data("targets")
    for rel, weight in TARGETS + EXPRESSION:
        TargetService.load_target(human, os.path.join(tdir, rel), weight=weight)
    rig = HumanService.add_builtin_rig(human, RIG)
    rig.name = "rig"
    bake_shape_keys(human)
    for m in list(human.modifiers):
        if m.type != "ARMATURE":
            human.modifiers.remove(m)
    # skeleton, landmarks, hair and shorts all come from the shared shape; variant B only moves face vertices
    base = extract(human, group_members(human, ["body"]), "base")
    tights = extract(human, group_members(human, ["helper-tights"]), "tights")
    frame = HeadFrame(base, rig)
    if args.variant == "b":
        for rel, weight in FACE_B:
            TargetService.load_target(human, os.path.join(tdir, rel), weight=weight)
        bake_shape_keys(human)
        body = extract(human, group_members(human, ["body"]), "body")
    else:
        body = base
        body.name = body.data.name = "body"
    eyes = extract(human, group_members(human, ["helper-l-eye", "helper-r-eye"]), "eyes")
    bpy.data.objects.remove(human)

    if args.variant == "b":
        stylize_face(body, frame)
    surfaces = [body] if base is body else [body, base]
    stats = [soften_hidden(o) for o in surfaces][0]

    ears = group_members(body, ["ears"])
    dropped = {n: "head" for n in face_bones(rig)}
    dropped.update(MERGE_INTO)
    meshes = surfaces + [eyes, tights]
    for o in meshes:
        process_weights(o, rig, dropped)
    smoothed = [smooth_weights(o, smooth_regions(rig)) for o in surfaces][0]
    remove_bones(rig, list(dropped))
    for o in meshes:
        drop_foreign_groups(o, rig)
    rename_bones(rig, meshes)

    lowres = lowres_faces(body, rig, frame, ears)
    sub = [subdivide_partial(o, lowres) for o in surfaces][0]
    subdivide_full(eyes)
    subdivide_full(tights)
    for o in meshes:
        process_weights(o, rig, {})
    eyes_info = eye_uvs(eyes, frame)

    hair = make_hair(base, frame)
    if base is not body:
        bpy.data.objects.remove(base)
    shorts = make_shorts(tights, body, rig, frame)
    bpy.data.objects.remove(tights)

    for o, name in ((body, "skin"), (eyes, "eyes"), (hair, "hair"), (shorts, "shorts")):
        triangulate_fixed(o)
        set_material(o, name)

    names = [b.name for b in rig.data.bones]
    table, deg = padded_neighbors(mesh_adjacency(body.data), len(body.data.vertices))
    mix = dqs_mix(body, names, table, deg)
    set_channel(body, 2, mix)
    shorts_mix = SurfaceBind(get_co(body.data), triangles(body.data), get_co(shorts.data)).interp(mix)
    set_channel(shorts, 2, shorts_mix)
    for o in (hair, eyes):
        t, d = padded_neighbors(mesh_adjacency(o.data), len(o.data.vertices))
        set_channel(o, 2, dqs_mix(o, names, t, d))
    write_colors(body, frame, args.variant)
    ao = {o.name: bake_ao(o, occ) for o, occ in ((body, [body, hair, eyes]), (shorts, [shorts, body]))}

    corr = [] if args.no_correctives else build_correctives(rig, body, [(shorts, shorts_mix)], mix)

    bpy.ops.object.select_all(action="DESELECT")
    for o in (rig, body, shorts, hair, eyes):
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(args.out),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_skins=True,
        export_influence_nb=4,
        export_def_bones=False,
        export_leaf_bone=False,
        export_rest_position_armature=True,
        export_morph=True,
        export_morph_normal=False,
        export_morph_tangent=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )

    report = dict(
        variant=args.variant,
        mpfb=MPFB_VERSION,
        rig=RIG,
        macros=MACROS,
        targets=TARGETS + EXPRESSION + (FACE_B if args.variant == "b" else []),
        blender=bpy.app.version_string,
        meshes={o.name: dict(vertices=len(o.data.vertices), triangles=sum(len(p.vertices) - 2 for p in o.data.polygons))
                for o in (body, shorts, hair, eyes)},
        subdivision=sub,
        eyes=eyes_info,
        bones=[dict(name=b.name, parent=b.parent.name if b.parent else None) for b in rig.data.bones],
        softened=stats,
        weightSmoothedVerts=smoothed,
        ao=ao,
        correctives=corr,
        height=float(max(v.co.z for v in body.data.vertices) - min(v.co.z for v in body.data.vertices)),
    )
    if args.report:
        with open(args.report, "w") as f:
            json.dump(report, f, indent=2)
    print("BUILD_BODY_OK", json.dumps({k: report[k] for k in ("variant", "meshes", "height")}))


main()
