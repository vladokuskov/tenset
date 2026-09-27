"""Angle-keyed corrective shape keys, generated in code (no sculpting). Our own code.

For each key: pose the rig, skin the rest mesh exactly like the runtime, relax the joint region with delta mush,
map the relaxed positions back to rest space through the inverse per-vertex skin transform and store the difference.
The runtime (src/features/figure/correctives.ts) sets each weight from the measured joint angle:
smoothstep(start, end, angle), where `end` is the angle of the key pose.

Followers (the shorts) take the body's delta at their closest body point, then are pushed out of the corrected
body in the key pose so the skin never pokes through.

Morph normals: the normal of the relaxed posed surface, rotated back to rest space by each vertex's skin transform.
They ride along as companion shape keys `<name>__n` (co = basis + normal delta), which build-body.ts moves into the
target's NORMAL slot. Normals of the rest-space shape itself are wrong here: it is the inverse-skinned surface.
"""
import numpy as np

from meshops import SurfaceBind, get_co, laplacian_smooth, mesh_adjacency, padded_neighbors, smoothstep, triangles, vertex_normals
from skinning import Angles, apply_pose, bone_matrices, delta_mush, reset_pose, skin, skin_arrays, sym, unskin

ARMS_DOWN = sym({"upperarm01": {"aim": (0.1, -1, 0.02)}})

ARMS_FORWARD = sym({
    "clavicle": {"rot": (0, 0, 4)},
    "shoulder01": {"rot": (0, 0, 4)},
    "upperarm01": {"aim": (0.12, 0.766, 0.643)},
})

OVERHEAD = sym({
    "clavicle": {"rot": (0, 0, 8)},
    "shoulder01": {"rot": (0, 0, 8)},
    "upperarm01": {"aim": (0.24, 1, 0.05)},
})

SQUAT = {
    "root": {"rot": (26, 0, 0)},
    "spine05": {"rot": (6, 0, 0)},
    "spine04": {"rot": (4, 0, 0)},
    "spine03": {"rot": (2, 0, 0)},
    **sym({
        "upperleg01": {"rot": (-88, 18, 0)},
        "lowerleg01": {"local": (140, 0, 0)},
    }),
}

# plane: shoulder keys split raised arms by plane of elevation (side / front), cross-faded between 30 and 70 deg
# region: (bone whose rest head is the centre, full-strength radius, zero radius)
# shrink: (amount, radius) pull towards the posed joint centre after relaxing; lowered arms swing the deltoid out
# into a square "shoulder pad", which smoothing alone cannot round
CORRECTIVES = [
    dict(name="shoulder_up", kind="shoulder", plane="side", pose=OVERHEAD, start=95, iters=24, region=("upperarm01", 0.09, 0.22)),
    dict(name="shoulder_fwd", kind="shoulder", plane="front", pose=ARMS_FORWARD, start=95, iters=24, region=("upperarm01", 0.09, 0.22)),
    dict(name="shoulder_down", kind="shoulder", pose=ARMS_DOWN, start=34, iters=40, region=("upperarm01", 0.09, 0.21), shrink=(0.28, 0.13)),
    dict(name="hip", kind="hip", pose=SQUAT, start=40, iters=30, region=("upperleg01", 0.10, 0.24)),
    dict(name="knee", kind="knee", pose=SQUAT, start=75, iters=14, region=("lowerleg01", 0.055, 0.14)),
]


def plane_split(elevation, plane_angle):
    """0 = side key, 1 = front key; near vertical the plane is undefined and the side key takes over"""
    return float(smoothstep(30, 70, np.array(plane_angle)) * smoothstep(178, 165, np.array(elevation)))


def weight(angles, c):
    """keep in sync with Correctives.update in src/features/figure/correctives.ts"""
    a = angles.measure(c["kind"], c["side"])
    w = float(smoothstep(c["start"], c["end"], np.array(a)))
    if c.get("plane"):
        t = plane_split(a, angles.shoulder_plane(c["side"]))
        w *= t if c["plane"] == "front" else 1 - t
    return w


def region_mask(rig, X, spec, side):
    B = rig.data.bones
    bone, r_in, r_out = spec["region"]
    c = np.array(B[f"{bone}_{side}"].head_local)
    d = np.linalg.norm(X - c, axis=1)
    m = smoothstep(r_out, r_in, d)
    s = 1 if side == "L" else -1
    m *= smoothstep(-0.025, 0.025, s * X[:, 0])
    if spec["kind"] == "shoulder":
        # stay off the neck: other poses move it independently (the squat extends it) and the deltas would not fit
        neck = B["neck01"].head_local.z
        m *= smoothstep(neck + 0.02, neck - 0.05, X[:, 2])
    return m


def shrink(rig, spec, side, P):
    if "shrink" not in spec:
        return P
    amount, radius = spec["shrink"]
    c = np.array(rig.pose.bones[f"{spec['region'][0]}_{side}"].head)
    d = P - c
    f = amount * smoothstep(radius, 0.0, np.linalg.norm(d, axis=1))
    return c + d * (1 - f)[:, None]


def add_key(obj, name, co):
    kb = obj.shape_key_add(name=name, from_mix=False)
    kb.data.foreach_set("co", np.asarray(co, np.float32).ravel())


MARGIN = 0.003


class Follower:
    def __init__(self, obj, names, mix, X, tris):
        self.obj = obj
        self.Y = get_co(obj.data)
        self.idx, self.w = skin_arrays(obj, names)
        self.mix = mix
        self.tris = triangles(obj.data)
        self.N0 = vertex_normals(self.Y, self.tris)
        self.table, self.deg = padded_neighbors(mesh_adjacency(obj.data), len(self.Y))
        self.bind = SurfaceBind(X, tris, self.Y)
        # clearance at rest; the inward-turned hems already sit inside the skin and are left alone
        n0 = self.bind.interp(vertex_normals(X, tris))
        n0 /= np.linalg.norm(n0, axis=1, keepdims=True)
        self.keep = np.minimum(((self.Y - self.bind.interp(X)) * n0).sum(1), MARGIN)

    def key(self, M, D, Pt, body_tris):
        """Rest-space position and normal deltas: follow the body, then clear the posed corrected body."""
        Yd = self.Y + self.bind.interp(D)
        A, S = skin(Yd, self.idx, self.w, M, self.mix)
        near = SurfaceBind(Pt, body_tris, S)
        foot = near.interp(Pt)
        n = near.interp(vertex_normals(Pt, body_tris))
        n /= np.linalg.norm(n, axis=1, keepdims=True)
        depth = np.maximum(self.keep - ((S - foot) * n).sum(1), 0)
        push = laplacian_smooth(n * depth[:, None], self.table, self.deg, 4)
        S = S + push
        N = np.einsum("vji,vj->vi", A[:, :3, :3], vertex_normals(S, self.tris))
        N /= np.linalg.norm(N, axis=1, keepdims=True)
        return unskin(A, S) - self.Y, N - self.N0, float(depth.max())


def build_correctives(rig, body, followers, mix):
    """followers: [(object, per-vertex DQS mix)]"""
    names = [b.name for b in rig.data.bones]
    idx, w = skin_arrays(body, names)
    X = get_co(body.data)
    table, deg = padded_neighbors(mesh_adjacency(body.data), len(X))
    tris = triangles(body.data)
    N0 = vertex_normals(X, tris)
    angles = Angles(rig)
    follow = [Follower(o, names, fm, X, tris) for o, fm in followers]
    for o in [body] + [f.obj for f in follow]:
        if not o.data.shape_keys:
            o.shape_key_add(name="Basis", from_mix=False)
    out = []
    mushed = {}
    for spec in CORRECTIVES:
        key = id(spec["pose"]), spec["iters"]
        apply_pose(rig, spec["pose"])
        M = bone_matrices(rig, names)
        A, P = skin(X, idx, w, M, mix)
        if key not in mushed:
            mushed[key] = delta_mush(X, P, table, deg, tris, spec["iters"])
        Pm = mushed[key]
        for side in ("L", "R"):
            name = f"cor_{spec['name']}_{side}"
            m = region_mask(rig, X, spec, side)
            Pt = P + m[:, None] * (shrink(rig, spec, side, Pm) - P)
            D = unskin(A, Pt) - X
            N = np.einsum("vji,vj->vi", A[:, :3, :3], vertex_normals(Pt, tris))
            N /= np.linalg.norm(N, axis=1, keepdims=True)
            dN = N - N0
            off = m < 1e-4
            D[off] = 0
            dN[off] = 0
            add_key(body, name, X + D)
            add_key(body, f"{name}__n", X + dN)
            cleared = 0.0
            for f in follow:
                fD, fN, depth = f.key(M, D, Pt, tris)
                add_key(f.obj, name, f.Y + fD)
                add_key(f.obj, f"{name}__n", f.Y + fN)
                cleared = max(cleared, depth)
            out.append(dict(
                name=name, kind=spec["kind"], side=side, start=spec["start"], plane=spec.get("plane"),
                planeAngle=round(angles.shoulder_plane(side), 1) if spec["kind"] == "shoulder" else None,
                end=round(angles.measure(spec["kind"], side), 2),
                maxDelta=round(float(np.linalg.norm(D, axis=1).max()), 4),
                verts=int((m > 1e-4).sum()),
                shortsPush=round(cleared, 4),
            ))
    reset_pose(rig)
    return out
