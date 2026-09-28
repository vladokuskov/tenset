// Grip definitions for hands.ts. Left hand in the wrist frame: +X palmar, +Y towards the fingers, +Z towards the thumb.

/** a wrap grip: every finger closes onto a handle cylinder placed against the palm */
export type WrapDef = {
  /** handle axis tilt in the palm plane (deg): + puts the little-finger end nearer the wrist */
  tilt: number
  /** handle axis distance behind the middle knuckle, along the hand (m) */
  depth: number
  /** fingers towards the middle finger, 0..1 of their rest splay */
  spread: number
  thumb: 'wrap' | 'hook'
}

/** where the thumb pad rests on a posed hand: beside an index finger segment, `at` along it (0..1), offset radially
 * (away from the palm's midline) and along the palm normal (m) */
export type ThumbRest = { bone: 'finger2-1' | 'finger2-2' | 'finger2-3'; at: number; radial: number; palmar: number }

/** a hand shape that rests on or against something instead of closing round a handle (flat palm, cupped palm, fist) */
export type PosedDef = {
  /** flexion (deg) per finger, index to little: knuckle, middle and tip joints */
  mcp: number[]
  pip: number[]
  dip: number[]
  /** fingers towards the middle finger, 0..1 of their rest splay */
  spread: number
  thumb: ThumbRest
}

/** `diameter`: default handle diameter (m), also used for posed shapes */
export type GripDef = { diameter: number } & ({ wrap: WrapDef } | { posed: PosedDef })
