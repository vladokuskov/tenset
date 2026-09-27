"""Runtime-matching skinning, posing and joint angles. Our own code.

Skinning mirrors src/features/figure/dqs.ts (LBS/DQS blended by the baked per-vertex mix), posing mirrors
Rig.apply in src/features/figure/rig.ts (rot/aim/local/twist), and joint angles mirror correctives.ts.
"""
import math
import re

import bpy
import numpy as np
from mathutils import Quaternion, Vector

from meshops import laplacian_smooth, smoothstep, vertex_normals

DEG = math.pi / 180
Y = Vector((0.0, 1.0, 0.0))


# Baked per-vertex DQS mix (COLOR_0.b). DQS keeps volume under twist and at the hips, but bulges on the stretched
# side of large bends: raised arms balloon the lats. The upper torso and shoulder therefore skin linearly.
MIX_FACTORS = [
    (r"^(spine0[123]|neck0\d|head|clavicle_.|shoulder01_.|upperarm01_.)$", 0.0),
    (r"^upperarm02_.$", 0.5),
    (r"^spine04$", 0.5),
]


def mix_factor(name):
    for pat, f in MIX_FACTORS:
        if re.match(pat, name):
            return f
    return 1.0


def dqs_mix(obj, names, table, deg, iters=12):
    """Per-vertex DQS amount from bone factors, diffused so it never changes abruptly across the surface."""
    from meshops import laplacian_smooth

    idx, w = skin_arrays(obj, names)
    f = np.array([mix_factor(n) for n in names])
    m = (w * f[idx]).sum(1)
    m = laplacian_smooth(np.repeat(m[:, None], 3, 1), table, deg, iters)[:, 0]
    return np.clip(m, 0, 1)


def skin_arrays(obj, names):
    col = {n: i for i, n in enumerate(names)}
    gname = {g.index: g.name for g in obj.vertex_groups}
    n = len(obj.data.vertices)
    idx = np.zeros((n, 4), np.int64)
    w = np.zeros((n, 4))
    for v in obj.data.vertices:
        gs = sorted(((g.weight, col[gname[g.group]]) for g in v.groups if gname[g.group] in col and g.weight > 0), reverse=True)[:4]
        s = sum(x for x, _ in gs) or 1.0
        for k, (x, b) in enumerate(gs):
            idx[v.index, k] = b
            w[v.index, k] = x / s
    return idx, w


def set_weights(obj, names, idx, w):
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    groups = [obj.vertex_groups.new(name=n) for n in names]
    for v in range(len(idx)):
        for k in range(4):
            if w[v, k] > 1e-4:
                groups[idx[v, k]].add([v], float(w[v, k]), "REPLACE")


def _quat(m):
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        return np.array([(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s])
    if m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        return np.array([0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s])
    if m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        return np.array([(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s])
    s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
    return np.array([(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s])


def _quat_to_mat(q):
    x, y, z, w = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    R = np.empty((len(q), 3, 3))
    R[:, 0, 0] = 1 - 2 * (y * y + z * z)
    R[:, 0, 1] = 2 * (x * y - z * w)
    R[:, 0, 2] = 2 * (x * z + y * w)
    R[:, 1, 0] = 2 * (x * y + z * w)
    R[:, 1, 1] = 1 - 2 * (x * x + z * z)
    R[:, 1, 2] = 2 * (y * z - x * w)
    R[:, 2, 0] = 2 * (x * z - y * w)
    R[:, 2, 1] = 2 * (y * z + x * w)
    R[:, 2, 2] = 1 - 2 * (x * x + y * y)
    return R


def bone_matrices(rig, names):
    bpy.context.view_layer.update()
    return np.stack([np.array(rig.pose.bones[n].matrix @ rig.data.bones[n].matrix_local.inverted()) for n in names])


def skin(X, idx, w, M, mix):
    """Per-vertex affine transforms (V,4,4) of the blended LBS/DQS skinning, and skinned positions.

    `mix` is the per-vertex DQS amount (0 = linear blend, 1 = dual quaternion)."""
    q = np.stack([_quat(m[:3, :3]) for m in M])
    t = M[:, :3, 3]
    L = np.einsum("vk,vkij->vij", w, M[idx])
    qv = q[idx]
    sign = np.where((qv * qv[:, :1]).sum(-1) < 0, -1.0, 1.0)
    qv = qv * sign[..., None]
    tv = t[idx]
    dual = 0.5 * np.concatenate([qv[..., 3:] * tv + np.cross(tv, qv[..., :3]), -(tv * qv[..., :3]).sum(-1, keepdims=True)], -1)
    R = (w[..., None] * qv).sum(1)
    D = (w[..., None] * dual).sum(1)
    n = np.linalg.norm(R, axis=1, keepdims=True)
    R /= n
    D /= n
    T = 2 * (R[:, 3:] * D[:, :3] - D[:, 3:] * R[:, :3] + np.cross(R[:, :3], D[:, :3]))
    Q = np.tile(np.eye(4), (len(X), 1, 1))
    Q[:, :3, :3] = _quat_to_mat(R)
    Q[:, :3, 3] = T
    m = np.asarray(mix)[:, None, None]
    A = (1 - m) * L + m * Q
    P = np.einsum("vij,vj->vi", A[:, :3, :3], X) + A[:, :3, 3]
    return A, P


def unskin(A, P):
    Ainv = np.linalg.inv(A)
    return np.einsum("vij,vj->vi", Ainv[:, :3, :3], P) + Ainv[:, :3, 3]


# --- posing: body axes are X = figure's left, Y = up, Z = forward (three.js); Blender is X left, Z up, -Y forward


def b_vec(v):
    return Vector((v[0], -v[2], v[1]))


def euler_zyx(v):
    qx = Quaternion((1, 0, 0), v[0] * DEG)
    qy = Quaternion((0, 1, 0), v[1] * DEG)
    qz = Quaternion((0, 0, 1), v[2] * DEG)
    return qz @ qy @ qx


def body_rot(v):
    q = euler_zyx(v)
    axis = b_vec((q.x, q.y, q.z))
    return Quaternion((q.w, axis.x, axis.y, axis.z))


def mirror(spec):
    out = dict(spec)
    if "rot" in spec:
        r = spec["rot"]
        out["rot"] = (r[0], -r[1], -r[2])
    if "local" in spec:
        r = spec["local"]
        out["local"] = (r[0], -r[1], -r[2])
    if "aim" in spec:
        a = spec["aim"]
        out["aim"] = (-a[0], a[1], a[2])
    if "twist" in spec:
        out["twist"] = -spec["twist"]
    return out


def sym(left):
    out = {}
    for base, spec in left.items():
        out[f"{base}_L"] = spec
        out[f"{base}_R"] = mirror(spec)
    return out


def hierarchy(rig):
    out = []

    def walk(b):
        out.append(b)
        for c in b.children:
            walk(c)

    for b in rig.data.bones:
        if b.parent is None:
            walk(b)
    return out


def rest_hinge(rest_local):
    parent_y = rest_local.inverted() @ Y
    rest = math.degrees(math.acos(max(-1.0, min(1.0, parent_y.dot(Y)))))
    if rest < 4:
        return Vector((1, 0, 0)), 0.0
    return parent_y.cross(Y).normalized(), rest


def apply_pose(rig, joints):
    world = {}
    for b in hierarchy(rig):
        rest = b.matrix_local.to_quaternion()
        rest_local = (b.parent.matrix_local.to_quaternion().inverted() @ rest) if b.parent else rest
        parent = world[b.parent.name] if b.parent else Quaternion()
        w = parent @ rest_local
        spec = joints.get(b.name)
        if spec:
            if "flex" in spec:
                axis, rest_deg = rest_hinge(rest_local)
                w = w @ Quaternion(axis, (spec["flex"] - rest_deg) * DEG)
            if "local" in spec:
                w = w @ euler_zyx(spec["local"])
            if "rot" in spec:
                w = body_rot(spec["rot"]) @ w
            if "aim" in spec:
                frm = (w @ Y).normalized()
                w = frm.rotation_difference(b_vec(spec["aim"]).normalized()) @ w
            if "twist" in spec:
                w = w @ Quaternion(Y, spec["twist"] * DEG)
        world[b.name] = w
        pb = rig.pose.bones[b.name]
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = rest_local.inverted() @ parent.inverted() @ w
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def reset_pose(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


# --- joint angles (keep in sync with src/features/figure/correctives.ts)


def _head(rig, n):
    return np.array(rig.pose.bones[n].head)


def _axis(rig, n):
    pb = rig.pose.bones[n]
    return np.array((pb.tail - pb.head).normalized())


def _angle(a, b):
    c = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


class Angles:
    """Measured from bone positions and long axes only, so Blender and three.js agree."""

    def __init__(self, rig):
        reset_pose(rig)
        self.rig = rig
        root_rest = rig.data.bones["root"].matrix_local.to_quaternion()
        self.down = {}
        for s in ("L", "R"):
            thigh = Vector(_head(rig, f"lowerleg01_{s}") - _head(rig, f"upperleg01_{s}")).normalized()
            self.down[s] = root_rest.inverted() @ thigh

    def shoulder(self, s):
        r = self.rig
        arm = _head(r, f"lowerarm01_{s}") - _head(r, f"upperarm01_{s}")
        return _angle(arm, -_axis(r, "spine01"))

    def shoulder_plane(self, s):
        """Plane of elevation in the chest frame: 0 = to the side, 90 = straight forward."""
        r = self.rig
        arm = _head(r, f"lowerarm01_{s}") - _head(r, f"upperarm01_{s}")
        m = r.pose.bones["spine01"].matrix
        up = np.array(m.col[1][:3])
        lat = np.array(m.col[0][:3])
        lat -= np.dot(lat, up) * up
        lat /= np.linalg.norm(lat)
        fwd = np.cross(lat, up)
        return math.degrees(math.atan2(np.dot(arm, fwd), abs(np.dot(arm, lat))))

    def hip(self, s):
        r = self.rig
        rot = r.pose.bones["root"].matrix.to_quaternion()
        fwd = _axis(r, "root")
        down = np.array(rot @ self.down[s])
        thigh = _head(r, f"lowerleg01_{s}") - _head(r, f"upperleg01_{s}")
        lat = np.cross(fwd, down)
        lat /= np.linalg.norm(lat)
        ts = thigh - np.dot(thigh, lat) * lat
        fo = fwd - np.dot(fwd, down) * down
        fo /= np.linalg.norm(fo)
        return math.degrees(math.atan2(np.dot(ts, fo), np.dot(ts, down)))

    def knee(self, s):
        r = self.rig
        thigh = _head(r, f"lowerleg01_{s}") - _head(r, f"upperleg01_{s}")
        shin = _head(r, f"foot_{s}") - _head(r, f"lowerleg01_{s}")
        return _angle(thigh, shin)

    def measure(self, kind, s):
        return getattr(self, kind)(s)


def delta_mush(X, P, table, deg, tris, iters):
    """Smooth the posed mesh, then re-add the rest-pose detail in local frames (delta mush)."""
    Sx = laplacian_smooth(X, table, deg, iters)
    Sp = laplacian_smooth(P, table, deg, iters)

    def frames(S):
        N = vertex_normals(S, tris)
        T = S[table[:, 0]] - S
        T -= (T * N).sum(1, keepdims=True) * N
        T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
        return T, np.cross(N, T), N

    Tx, Bx, Nx = frames(Sx)
    d = X - Sx
    local = np.stack([(d * Tx).sum(1), (d * Bx).sum(1), (d * Nx).sum(1)], 1)
    Tp, Bp, Np = frames(Sp)
    return Sp + local[:, :1] * Tp + local[:, 1:2] * Bp + local[:, 2:] * Np
