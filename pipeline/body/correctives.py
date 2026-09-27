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

ABDUCT = sym({
    "clavicle": {"rot": (0, 0, 7)},
    "shoulder01": {"rot": (0, 0, 7)},
    "upperarm01": {"aim": (1, 0, 0.05)},
})

FLEX = sym({
    "clavicle": {"rot": (0, 0, 3)},
    "shoulder01": {"rot": (0, 0, 3)},
    "upperarm01": {"aim": (0.12, 0, 1)},
})

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
# after: raised-arm keys come in pairs per plane (90 deg, overhead); the overhead key starts where the 90 deg key is
#   full and the 90 deg key fades out towards the overhead angle, so the pair always sums to one
# region: (bone whose rest head is the centre, full-strength radius, zero radius)
# shrink: (amount, radius) pull towards the posed joint centre after relaxing; lowered arms swing the deltoid out
# into a square "shoulder pad", which smoothing alone cannot round
# lat: (lo, hi) sharpens the smoothed arm/torso weight split around the armpit: below `lo` arm share a vertex
#   skins without the arm, above `hi` with the arm only. Keeps the inner upper arm on the arm instead of webbing
#   down to the ribcage, so the lat reads as a band from the armpit instead of a sail
# sculpt: soft blobs pushed along the relaxed normal (metres, + out): the deltoid bunches into a rounded cap when it
#   contracts; the lat and the front of the armpit thin out as they stretch overhead. See sculpt_mask for the frames.
DELT_SIDE = (0.016, "side", (0.045, 0.03), (0.09, 0.065, 0.07))
DELT_FRONT = (0.013, "front", (0.04, 0.028), (0.085, 0.065, 0.065))
DELT_TOP = (0.0095, "top", (0.05, 0.03), (0.095, 0.065, 0.07))
LAT = (-0.007, "body", (-0.015, -0.035, -0.10), (0.05, 0.06, 0.09))
PEC = (-0.004, "body", (-0.03, 0.06, -0.07), (0.05, 0.05, 0.06))
SHOULDER = dict(kind="shoulder", iters=24, region=("upperarm01", 0.09, 0.22), lat=(0.22, 0.6))
CORRECTIVES = [
    dict(SHOULDER, name="shoulder_side", plane="side", pose=ABDUCT, start=20, sculpt=[DELT_SIDE, (LAT[0] * 0.4, *LAT[1:])]),
    dict(SHOULDER, name="shoulder_up", plane="side", pose=OVERHEAD, after="shoulder_side", sculpt=[DELT_TOP, LAT, PEC]),
    dict(SHOULDER, name="shoulder_flex", plane="front", pose=FLEX, start=20, sculpt=[DELT_FRONT]),
    dict(SHOULDER, name="shoulder_fwd", plane="front", pose=ARMS_FORWARD, after="shoulder_flex", sculpt=[DELT_TOP, LAT, PEC]),
    dict(name="shoulder_down", kind="shoulder", pose=ARMS_DOWN, start=34, iters=40, region=("upperarm01", 0.09, 0.21), shrink=(0.28, 0.13)),
    dict(name="hip", kind="hip", pose=SQUAT, start=40, iters=30, region=("upperleg01", 0.10, 0.24)),
    dict(name="knee", kind="knee", pose=SQUAT, start=75, iters=14, region=("lowerleg01", 0.055, 0.14)),
]

ARM_CHAIN = ("upperarm", "lowerarm", "wrist", "metacarpal", "finger")


def plane_split(elevation, plane_angle):
    """0 = side key, 1 = front key; near vertical the plane is undefined and the side key takes over"""
    return float(smoothstep(30, 70, np.array(plane_angle)) * smoothstep(178, 165, np.array(elevation)))


def weight(angles, c):
    """keep in sync with Correctives.weight in src/features/figure/correctives.ts"""
    a = angles.measure(c["kind"], c["side"])
    w = float(smoothstep(c["start"], c["end"], np.array(a)))
    if c.get("fade"):
        w *= 1 - float(smoothstep(c["end"], c["fade"], np.array(a)))
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
    """smooth: per-vertex 0..1 where the fabric skips the body's delta in hip keys (between the legs)
    pad: per-vertex extra clearance (metres) in hip keys, where other seated stances press the thighs closer"""

    def __init__(self, obj, names, mix, X, tris, smooth=None, pad=None):
        self.obj = obj
        self.Y = get_co(obj.data)
        self.idx, self.w = skin_arrays(obj, names)
        self.mix = mix
        self.tris = triangles(obj.data)
        self.N0 = vertex_normals(self.Y, self.tris)
        self.table, self.deg = padded_neighbors(mesh_adjacency(obj.data), len(self.Y))
        self.bind = SurfaceBind(X, tris, self.Y)
        self.smooth = smooth
        self.pad = pad
        # clearance at rest; the inward-turned hems already sit inside the skin and are left alone
        n0 = self.bind.interp(vertex_normals(X, tris))
        n0 /= np.linalg.norm(n0, axis=1, keepdims=True)
        self.keep = np.minimum(((self.Y - self.bind.interp(X)) * n0).sum(1), MARGIN)

    def clear(self, S, Pt, body_tris, keep):
        near = SurfaceBind(Pt, body_tris, S)
        n = near.interp(vertex_normals(Pt, body_tris))
        n /= np.linalg.norm(n, axis=1, keepdims=True)
        depth = np.maximum(keep - ((S - near.interp(Pt)) * n).sum(1), 0)
        return S + laplacian_smooth(n * depth[:, None], self.table, self.deg, 4), float(depth.max())

    def key(self, M, D, Pt, body_tris, side, still=False):
        """Rest-space position and normal deltas: follow the body (this side's corrective), then clear the posed
        corrected body. Clearing acts on the whole garment, so each side's key keeps only its half.
        still: where `smooth` is set the garment skips the body's delta and is only pushed out of the corrected body
        (between the legs a hip key's rest-space delta, made for one squat stance, crumples the fabric in other
        stances such as sitting; without the push the inner thighs poke through when seated)."""
        fD = self.bind.interp(D)
        if still and self.smooth is not None:
            fD *= (1 - self.smooth)[:, None]
        A, S0 = skin(self.Y + fD, self.idx, self.w, M, self.mix)
        keep = np.maximum(self.keep, self.pad) if still and self.pad is not None else self.keep
        S, depth = self.clear(S0, Pt, body_tris, keep)
        s = 1 if side == "L" else -1
        half = smoothstep(-0.02, 0.02, s * self.Y[:, 0])
        S = S0 + half[:, None] * (S - S0)
        N = np.einsum("vji,vj->vi", A[:, :3, :3], vertex_normals(S, self.tris))
        N /= np.linalg.norm(N, axis=1, keepdims=True)
        dY, dN = unskin(A, S) - self.Y, N - self.N0
        return dY, dN, depth


def arm_share(names, idx, w, side):
    arm = np.array([n.endswith(f"_{side}") and n.startswith(ARM_CHAIN) for n in names])
    return (w * arm[idx]).sum(1), arm


def sharpened(idx, w, arm, share, lo, hi):
    """skin weights blended from torso-only to arm-only by smoothstep(lo, hi, arm share)"""
    def only(keep):
        w2 = np.where(keep, w, 0.0)
        tot = w2.sum(1, keepdims=True)
        return np.where(tot > 1e-6, w2 / np.maximum(tot, 1e-6), w)

    t = smoothstep(lo, hi, share)[:, None]
    return (1 - t) * only(~arm[idx]) + t * only(arm[idx])


def sculpt_mask(rig, X, side, frame, center, radii):
    """Soft ellipsoid in rest space around the shoulder joint J.
    Arm frames ("side", "front", "top": which part of the deltoid): center = (along the arm, out from its axis).
    "body": center = (lateral, forward, up) in metres, mirrored per side."""
    B = rig.data.bones
    J = np.array(B[f"upperarm01_{side}"].head_local)
    s = 1 if side == "L" else -1
    if frame == "body":
        axes = [np.array([s, 0.0, 0.0]), np.array([0.0, -1.0, 0.0]), np.array([0.0, 0.0, 1.0])]
        C = J + sum(c * ax for c, ax in zip(center, axes))
    else:
        a = np.array(B[f"lowerarm01_{side}"].head_local) - J
        a /= np.linalg.norm(a)

        def perp(v):
            v = v - (v @ a) * a
            return v / np.linalg.norm(v)

        out, fwd = perp(np.array([s, 0.0, 0.0])), perp(np.array([0.0, -1.0, 0.0]))
        o = {"side": out, "front": out * 0.45 + fwd * 0.9, "top": out * 0.8 + fwd * 0.45}[frame]
        o /= np.linalg.norm(o)
        axes = [a, o, np.cross(a, o)]
        C = J + a * center[0] + o * center[1]
    d = X - C
    r = np.stack([(d @ ax) / rad for ax, rad in zip(axes, radii)], 1)
    return smoothstep(1.0, 0.15, np.linalg.norm(r, axis=1))


def build_correctives(rig, body, followers, mix):
    """followers: [(object, per-vertex DQS mix, still mask or None, hip clearance or None)]"""
    names = [b.name for b in rig.data.bones]
    idx, w = skin_arrays(body, names)
    X = get_co(body.data)
    table, deg = padded_neighbors(mesh_adjacency(body.data), len(X))
    tris = triangles(body.data)
    N0 = vertex_normals(X, tris)
    angles = Angles(rig)
    follow = [Follower(o, names, fm, X, tris, sm, pad) for o, fm, sm, pad in followers]
    for o in [body] + [f.obj for f in follow]:
        if not o.data.shape_keys:
            o.shape_key_add(name="Basis", from_mix=False)
    ends = {}
    for spec in CORRECTIVES:
        apply_pose(rig, spec["pose"])
        ends[spec["name"]] = round(angles.measure(spec["kind"], "L"), 2)
    out = []
    mushed = {}
    for spec in CORRECTIVES:
        start = ends[spec["after"]] if spec.get("after") else spec["start"]
        fade = next((ends[c["name"]] for c in CORRECTIVES if c.get("after") == spec["name"]), None)
        key = id(spec["pose"]), spec["iters"]
        apply_pose(rig, spec["pose"])
        M = bone_matrices(rig, names)
        A, P = skin(X, idx, w, M, mix)
        pulled = {}
        if spec.get("lat"):
            lo, hi = spec["lat"]
            for side in ("L", "R"):
                share, arm = arm_share(names, idx, w, side)
                _, pulled[side] = skin(X, idx, sharpened(idx, w, arm, share, lo, hi), M, mix)
        if key not in mushed:
            both = P + sum((q - P for q in pulled.values()), np.zeros_like(P))
            mushed[key] = delta_mush(X, both, table, deg, tris, spec["iters"])
        Pm = mushed[key]
        for side in ("L", "R"):
            name = f"cor_{spec['name']}_{side}"
            m = region_mask(rig, X, spec, side)
            base = pulled.get(side, P)
            Pt = base + m[:, None] * (shrink(rig, spec, side, Pm) - base)
            if spec.get("sculpt"):
                push = sum(amount * sculpt_mask(rig, X, side, frame, c, r) for amount, frame, c, r in spec["sculpt"])
                Pt = Pt + push[:, None] * vertex_normals(Pt, tris)
            D = unskin(A, Pt) - X
            N = np.einsum("vji,vj->vi", A[:, :3, :3], vertex_normals(Pt, tris))
            N /= np.linalg.norm(N, axis=1, keepdims=True)
            dN = N - N0
            off = np.linalg.norm(D, axis=1) < 1e-5
            D[off] = 0
            dN[off] = 0
            add_key(body, name, X + D)
            add_key(body, f"{name}__n", X + dN)
            cleared = 0.0
            for f in follow:
                fD, fN, depth = f.key(M, D, Pt, tris, side, still=spec["kind"] == "hip")
                add_key(f.obj, name, f.Y + fD)
                add_key(f.obj, f"{name}__n", f.Y + fN)
                cleared = max(cleared, depth)
            out.append(dict(
                name=name, kind=spec["kind"], side=side, start=start, end=ends[spec["name"]], fade=fade, plane=spec.get("plane"),
                planeAngle=round(angles.shoulder_plane(side), 1) if spec["kind"] == "shoulder" else None,
                maxDelta=round(float(np.linalg.norm(D, axis=1).max()), 4),
                verts=int((~off).sum()),
                shortsPush=round(cleared, 4),
            ))
    reset_pose(rig)
    return out
