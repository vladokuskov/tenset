// Rep timing. Tempo is Wilk notation in seconds: [eccentric, pause at the lengthened end, concentric, pause at the
// shortened end]. The loop starts in the middle of the last pause so the seam sits in a still moment.
// `c` is contraction: 1 at the end of the concentric, 0 at the end of the eccentric. Templates map c to angles.

export type Tempo = [number, number, number, number]
export type PhaseName = 'top' | 'ecc' | 'bottom' | 'con'

export const DEFAULT_TEMPO: Tempo = [2, 0.2, 1, 0.5]

export function loopDuration(t: Tempo) {
  return t[0] + t[1] + t[2] + t[3]
}

/** Flash & Hogan minimum-jerk position profile on [0, 1]: zero velocity and acceleration at both ends */
export function minJerk(x: number) {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x
  return t * t * t * (10 + t * (-15 + 6 * t))
}

export function minJerkVelocity(x: number) {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x
  return 30 * t * t * (1 - t) * (1 - t)
}

export type Phase = { name: PhaseName; c: number; /** dc per second */ velocity: number; /** 0..1 within the phase */ progress: number }

const wrap01 = (u: number) => u - Math.floor(u)

/** phase at loop fraction u in [0, 1); lag shifts this joint later by a fraction of the loop */
export function phaseAt(u: number, tempo: Tempo = DEFAULT_TEMPO, lag = 0): Phase {
  const [ecc, pb, con, pt] = tempo
  const T = loopDuration(tempo)
  let t = wrap01(u - lag) * T
  const half = pt / 2
  if (t < half) return { name: 'top', c: 1, velocity: 0, progress: 0.5 + (half > 0 ? t / half / 2 : 0) }
  t -= half
  if (t < ecc) return { name: 'ecc', c: 1 - minJerk(t / ecc), velocity: -minJerkVelocity(t / ecc) / ecc, progress: t / ecc }
  t -= ecc
  if (t < pb) return { name: 'bottom', c: 0, velocity: 0, progress: pb > 0 ? t / pb : 0 }
  t -= pb
  if (t < con) return { name: 'con', c: minJerk(t / con), velocity: minJerkVelocity(t / con) / con, progress: t / con }
  t -= con
  return { name: 'top', c: 1, velocity: 0, progress: half > 0 ? t / half / 2 : 0 }
}

/** contraction only, the common case */
export function contraction(u: number, tempo: Tempo = DEFAULT_TEMPO, lag = 0) {
  return phaseAt(u, tempo, lag).c
}

/** number of frames for one loop at fps; frame i sits at u = i / n */
export function frameCount(tempo: Tempo, fps: number) {
  return Math.max(2, Math.round(loopDuration(tempo) * fps))
}
