"""Head landmarks, the stylized face, brow/hairline masks and eye UVs. Our own code."""
import math

import bmesh
import numpy as np

from meshops import adjacency, get_co, set_co, smoothstep


class HeadFrame:
    """Landmarks from the rig and the base mesh, captured before the face bones are merged into `head`."""

    def __init__(self, body, rig):
        B = rig.data.bones
        self.eyes = [np.array(B[f"eye.{s}"].head_local) for s in ("L", "R")]
        mid = (self.eyes[0] + self.eyes[1]) / 2
        self.eye_mid = mid
        self.eye_x = abs(self.eyes[0][0])
        P = get_co(body.data)
        head = P[(P[:, 2] > mid[2] - 0.2)]
        self.top = float(head[:, 2].max())
        self.back = float(head[:, 1].max())
        self.k = (self.top - mid[2]) / 0.115
        k = self.k
        self.center = np.array([0.0, mid[1] + 0.085 * k, mid[2] + 0.005 * k])
        groups = {g.name: g.index for g in body.vertex_groups}
        ears = groups.get("ears")
        self.ear = None
        if ears is not None:
            idx = [v.index for v in body.data.vertices if any(g.group == ears and g.weight > 0.5 for g in v.groups)]
            E = P[idx]
            self.ear = dict(center=E[E[:, 0] > 0].mean(0), zmax=float(E[:, 2].max()), zmin=float(E[:, 2].min()), r=0.034 * k)
        lips = groups.get("lips")
        self.mouth = P[[v.index for v in body.data.vertices if any(g.group == lips for g in v.groups)]].mean(0) if lips is not None else mid - [0, 0, 0.07]

    def spherical(self, P):
        d = P - self.center
        az = np.degrees(np.arctan2(np.abs(d[:, 0]), -d[:, 1]))
        el = np.degrees(np.arctan2(d[:, 2], np.hypot(d[:, 0], d[:, 1])))
        return az, el

    # hairline elevation (deg) against azimuth from the front (deg), short crew cut with sideburns
    HAIRLINE = [(0, 31), (15, 30.5), (28, 28), (38, 23.5), (46, 19.5), (54, 15), (60, 4), (66, -6), (74, -8), (81, 10), (92, 16), (104, 16), (118, 9), (132, -7), (150, -19), (165, -23), (180, -24)]

    def hairline(self, az):
        a, e = zip(*self.HAIRLINE)
        return np.interp(az, a, e)

    def ear_distance(self, P):
        if self.ear is None:
            return np.full(len(P), 1.0)
        c = self.ear["center"]
        q = P.copy()
        q[:, 0] = np.abs(q[:, 0])
        return np.linalg.norm((q - c) * [1.6, 1.0, 1.0], axis=1)

    def hair(self, P):
        """(depth in degrees above the hairline, ear clearance in metres); hair where both are positive."""
        az, el = self.spherical(P)
        depth = el - self.hairline(az)
        clear = self.ear_distance(P) - (self.ear["r"] if self.ear else 0)
        return depth, clear, az, el

    def brow(self, P, N):
        """Soft eyebrow mask in the frontal plane, relative to the eye centres."""
        k = self.k
        u = np.abs(P[:, 0]) / (self.eye_x / 0.031)
        v = (P[:, 2] - self.eye_mid[2]) / k
        u0, u1 = 0.008, 0.061
        t = np.clip((u - u0) / (u1 - u0), 0, 1)
        vc = 0.019 + 0.0055 * np.sin(np.pi * np.clip(t * 1.25, 0, 1)) - 0.004 * t * t
        h = 0.0052 * (1 - 0.5 * t)
        m = smoothstep(h, h * 0.45, np.abs(v - vc))
        m *= smoothstep(u0 - 0.002, u0 + 0.006, u) * smoothstep(u1 + 0.002, u1 - 0.012, u)
        m *= smoothstep(0.2, 0.5, -N[:, 1]) * (P[:, 1] < self.eye_mid[1] + 0.03)
        return m

    def mouth_mask(self, P):
        """1 on the lips and philtrum, fading out over ~1.5 cm"""
        k = self.k
        d = (P - self.mouth) / (np.array([0.03, 0.02, 0.022]) * k)
        d[:, 2] = np.where(d[:, 2] > 0, d[:, 2] * 0.6, d[:, 2])
        return smoothstep(1.0, 0.45, np.linalg.norm(d, axis=1))

    def face(self, P):
        """1 on the face (brow to chin, in front of the ears), fading out over ~2 cm."""
        k = self.k
        d = P - self.eye_mid
        front = smoothstep(0.045 * k, 0.015 * k, d[:, 1])
        vert = smoothstep(0.05 * k, 0.03 * k, d[:, 2]) * smoothstep(-0.115 * k, -0.085 * k, d[:, 2])
        side = smoothstep(0.075 * k, 0.05 * k, np.abs(d[:, 0]))
        return front * vert * side


def stylize_face(body, frame):
    """Stylized head: same topology, softened features (Taubin smoothing weighted by a face mask)."""
    me = body.data
    P = get_co(me)
    bm = bmesh.new()
    bm.from_mesh(me)
    nbrs = adjacency(bm)
    boundary = {v.index for v in bm.verts if v.is_boundary}
    bm.free()
    s = frame.face(P)
    near = set()
    for i in boundary:
        near.add(i)
        near.update(nbrs[i])
    s[list(boundary)] = 0
    s[list(near - boundary)] *= 0.35
    s *= 1 - 0.85 * frame.mouth_mask(P)
    ears = frame.ear_distance(P) < (frame.ear["r"] * 1.1 if frame.ear else 0)
    s = np.maximum(s, 0.6 * ears)
    idx = np.nonzero(s > 1e-3)[0]
    w = s[idx, None]

    def step(f):
        D = np.array([P[nbrs[i]].mean(0) - P[i] for i in idx])
        P[idx] += f * w * D

    for _ in range(14):
        step(0.5)
    for _ in range(10):
        step(0.5)
        step(-0.53)
    set_co(me, P)


def eye_uvs(eyes, frame, up=4.0):
    """Planar UVs per eyeball, pupil at (0.5, 0.5), so the eye shader can draw iris and pupil.
    The gaze is tilted `up` degrees above straight ahead: the elevated camera otherwise reads it as looking down."""
    me = eyes.data
    P = get_co(me)
    uv = me.uv_layers.active.data
    t = math.radians(up)
    ex, ey = np.array([1.0, 0, 0]), np.array([0, math.sin(t), math.cos(t)])
    centers = {}
    for s in (1, -1):
        sel = P[:, 0] * s > 0
        c = P[sel].mean(0)
        r = np.linalg.norm(P[sel] - c, axis=1).max()
        centers[s] = (c, r)
    for loop in me.loops:
        p = P[loop.vertex_index]
        c, r = centers[1 if p[0] > 0 else -1]
        d = (p - c) / r
        uv[loop.index].uv = (0.5 + 0.5 * d @ ex, 0.5 + 0.5 * d @ ey)
    return {("L" if s > 0 else "R"): dict(center=c.tolist(), radius=float(r)) for s, (c, r) in centers.items()}


def prune_eyes(eyes):
    """Drop the back of each eyeball (always inside the head)."""
    me = eyes.data
    P = get_co(me)
    bm = bmesh.new()
    bm.from_mesh(me)
    dead = []
    for s in (1, -1):
        sel = P[:, 0] * s > 0
        c = P[sel].mean(0)
        r = np.linalg.norm(P[sel] - c, axis=1).max()
        dead += [v for v in bm.verts if (v.co.x > 0) == (s > 0) and (v.co.y - c[1]) / r > 0.35]
    bmesh.ops.delete(bm, geom=dead, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    return len(dead)


def angle_deg(a, b):
    return math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(a, b))))))
