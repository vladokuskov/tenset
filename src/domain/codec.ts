import { sequentialIds, type IdFactory } from './ids.ts'
import { normalizeSupersets } from './program.ts'
import { Program, type CustomExercise, type Day, type Entry, type ExerciseRef } from './schema.ts'

// Share link format. Version byte first, then a compact binary program, then base64url.
// The tables below are part of the v1 wire format: append only, never reorder or remove.
// v2 is v1 plus one extension byte per entry. v3 is v2 plus an entry note flagged in that byte.
// Each program is written with the lowest version that holds it, so older cached apps keep reading
// links that use no newer field.

export const CODEC_VERSION = 3
const V1 = 1
const V2 = 2

export const REPS_PRESETS = ['3-5', '6-8', '8-12', '10-15', '15-20', '20-30'] as const

export const CODEC_GROUPS_V1 = [
  'chest', 'lats', 'upper_back', 'upper_traps', 'front_delt', 'side_delt', 'rear_delt', 'biceps', 'triceps',
  'forearms', 'abs', 'obliques', 'lower_back', 'glute_max', 'glute_med', 'quads', 'hamstrings', 'adductors',
  'calves', 'hip_flexors', 'rotator_cuff', 'serratus', 'tibialis',
] as const

export const CODEC_EQUIPMENT_V1 = [
  'barbell', 'dumbbell', 'ez_bar', 'flat_bench', 'adjustable_bench', 'rack', 'pullup_bar', 'dip_station', 'cable',
  'smith', 'leg_press', 'leg_extension', 'leg_curl_seated', 'leg_curl_lying', 'lat_pulldown', 'chest_press_machine',
  'shoulder_press_machine', 'pec_deck', 'hip_abduction', 'hip_adduction', 'back_extension', 'assisted_pullup',
  'calf_machine', 'seated_calf', 'plate', 'step', 'kettlebell', 'band', 'trap_bar', 'landmine', 'preacher_bench',
  'rings', 'ab_wheel', 'ghd', 't_bar', 'hack_squat', 'pendulum_squat', 'belt_squat',
] as const

const LATERALITY = ['bilateral', 'unilateral', 'alternating'] as const

/** Longest fragment decodeProgram accepts, and so the longest encodeProgram produces. */
export const SHARE_LINK_MAX = 16384
export const SHARE_DAY_ENTRIES_MAX = 255

// entry header byte: bit0 custom ref, bits1-2 reps kind, bits3-7 sets - 1
const REPS_NONE = 0
const REPS_PRESET = 1
const REPS_TEXT = 2

// v2 entry extension byte: bit0 rest follows (u8, steps of 15 s), bit1 has rir, bit2 superset with previous,
// bits3-5 rir, bit6 note follows the rest byte (v3 only, else 0), bit7 reserved (0)
const EXT_REST = 1
const EXT_RIR = 2
const EXT_WITH_PREV = 4
const EXT_NOTE = 0x40
const REST_STEP = 15
const REST_STEPS_MAX = 40

const usesV2 = (e: Entry) => e.restSec !== undefined || e.rir !== undefined || !!e.withPrev
const usesV3 = (e: Entry) => !!e.note

function versionFor(days: readonly Day[]): number {
  const entries = days.flatMap((d) => d.entries)
  return entries.some(usesV3) ? CODEC_VERSION : entries.some(usesV2) ? V2 : V1
}

class CodecError extends Error {}

/** The program cannot travel in a share link that decodeProgram would accept. */
export class ShareLinkError extends Error {}

function writer() {
  const bytes: number[] = []
  const enc = new TextEncoder()
  const w = {
    u8(n: number) {
      bytes.push(n & 0xff)
    },
    u16(n: number) {
      bytes.push((n >> 8) & 0xff, n & 0xff)
    },
    varint(n: number) {
      let v = n >>> 0
      while (v >= 0x80) {
        bytes.push((v & 0x7f) | 0x80)
        v >>>= 7
      }
      bytes.push(v)
    },
    str(s: string) {
      const b = enc.encode(s)
      w.varint(b.length)
      for (const x of b) bytes.push(x)
    },
    done: () => Uint8Array.from(bytes),
  }
  return w
}

function reader(bytes: Uint8Array) {
  let pos = 0
  const dec = new TextDecoder('utf-8', { fatal: true })
  const need = (n: number) => {
    if (pos + n > bytes.length) throw new CodecError('truncated')
  }
  const r = {
    u8() {
      need(1)
      return bytes[pos++]
    },
    u16() {
      need(2)
      const v = (bytes[pos] << 8) | bytes[pos + 1]
      pos += 2
      return v
    },
    varint() {
      let v = 0
      for (let shift = 0; shift < 28; shift += 7) {
        const b = r.u8()
        v |= (b & 0x7f) << shift
        if (!(b & 0x80)) return v >>> 0
      }
      throw new CodecError('varint too long')
    },
    str() {
      const len = r.varint()
      need(len)
      const s = dec.decode(bytes.subarray(pos, pos + len))
      pos += len
      return s
    },
    atEnd: () => pos === bytes.length,
  }
  return r
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new CodecError('bad characters')
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    throw new CodecError('bad base64')
  }
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const mask = (days: readonly Day[], pick: (d: Day) => boolean) =>
  days.reduce((m, d, i) => (pick(d) ? m | (1 << i) : m), 0)

const customNumber = (id: string) => Number(id.slice(1))

export function encodeProgram(program: Program): string {
  const w = writer()
  const version = versionFor(program.days)
  const ext = version >= V2
  w.u8(version)
  w.str(program.name)
  w.u8(mask(program.days, (d) => d.kind === 'train'))
  w.u8(mask(program.days, (d) => !!d.label))
  for (const d of program.days) if (d.label) w.str(d.label)
  w.u8(mask(program.days, (d) => !!d.note))
  for (const d of program.days) if (d.note) w.str(d.note)

  w.varint(program.custom.length)
  for (const c of program.custom) {
    w.u8(customNumber(c.id))
    w.str(c.name)
    w.u8(LATERALITY.indexOf(c.laterality))
    const eq = c.equipment.map((e) => CODEC_EQUIPMENT_V1.indexOf(e as never)).filter((i) => i >= 0)
    w.varint(eq.length)
    for (const i of eq) w.u8(i)
    const groups = Object.entries(c.groups)
      .map(([g, role]) => [CODEC_GROUPS_V1.indexOf(g as never), role] as const)
      .filter(([i]) => i >= 0)
    w.varint(groups.length)
    for (const [i, role] of groups) w.u8((i << 1) | (role === 'secondary' ? 1 : 0))
  }

  for (const d of program.days) {
    if (d.entries.length > SHARE_DAY_ENTRIES_MAX) throw new ShareLinkError(`over ${SHARE_DAY_ENTRIES_MAX} entries in a day`)
    w.varint(d.entries.length)
    for (const e of d.entries) {
      const custom = typeof e.exerciseId === 'string'
      const preset = e.reps === undefined ? -1 : REPS_PRESETS.indexOf(e.reps as never)
      const repsKind = e.reps === undefined ? REPS_NONE : preset >= 0 ? REPS_PRESET : REPS_TEXT
      w.u8((custom ? 1 : 0) | (repsKind << 1) | ((e.sets - 1) << 3))
      if (typeof e.exerciseId === 'string') w.u8(customNumber(e.exerciseId))
      else w.u16(e.exerciseId)
      if (repsKind === REPS_PRESET) w.u8(preset)
      else if (repsKind === REPS_TEXT) w.str(e.reps!)
      if (ext) {
        const rest = e.restSec === undefined ? -1 : Math.round(e.restSec / REST_STEP)
        w.u8(
          (rest >= 0 ? EXT_REST : 0) |
            (e.rir !== undefined ? EXT_RIR | (e.rir << 3) : 0) |
            (e.withPrev ? EXT_WITH_PREV : 0) |
            (e.note ? EXT_NOTE : 0),
        )
        if (rest >= 0) w.u8(rest)
        if (e.note) w.str(e.note)
      }
    }
  }
  const out = toBase64Url(w.done())
  if (out.length > SHARE_LINK_MAX) throw new ShareLinkError(`over ${SHARE_LINK_MAX} characters`)
  return out
}

export type DecodeOptions = {
  /** Retired catalog id -> replacement id; chains are followed. */
  replacedBy?: ReadonlyMap<number, number>
  makeId?: IdFactory
  id?: string
}

export type DecodeError = 'empty' | 'malformed' | 'unsupported_version' | 'invalid'
export type DecodeResult = { ok: true; program: Program } | { ok: false; error: DecodeError }

function mapRetired(id: number, replacedBy: ReadonlyMap<number, number> | undefined): number {
  if (!replacedBy) return id
  const seen = new Set<number>()
  let cur = id
  while (replacedBy.has(cur) && !seen.has(cur)) {
    seen.add(cur)
    cur = replacedBy.get(cur)!
  }
  return cur
}

export function decodeProgram(input: string, opts: DecodeOptions = {}): DecodeResult {
  const s = input.trim().replace(/^#/, '')
  if (!s) return { ok: false, error: 'empty' }
  if (s.length > SHARE_LINK_MAX) return { ok: false, error: 'malformed' }

  let candidate: unknown
  try {
    const bytes = fromBase64Url(s)
    const r = reader(bytes)
    const version = r.u8()
    if (version < V1 || version > CODEC_VERSION) return { ok: false, error: 'unsupported_version' }
    candidate = readV1(r, opts, version)
    if (!r.atEnd()) throw new CodecError('trailing bytes')
  } catch (e) {
    if (e instanceof CodecError || e instanceof TypeError || e instanceof RangeError) return { ok: false, error: 'malformed' }
    throw e
  }

  const parsed = Program.safeParse(candidate)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const customIds = new Set(parsed.data.custom.map((c) => c.id))
  if (customIds.size !== parsed.data.custom.length) return { ok: false, error: 'invalid' }
  for (const d of parsed.data.days) {
    for (const e of d.entries) {
      if (typeof e.exerciseId === 'string' && !customIds.has(e.exerciseId)) return { ok: false, error: 'invalid' }
    }
  }
  return { ok: true, program: parsed.data }
}

function readExtension(r: ReturnType<typeof reader>, entry: Entry, version: number) {
  const x = r.u8()
  if (x & (version >= CODEC_VERSION ? 0x80 : 0xc0)) throw new CodecError('extension bits')
  const rir = (x >> 3) & 7
  if (x & EXT_RIR) {
    if (rir > 5) throw new CodecError('rir')
    entry.rir = rir
  } else if (rir) throw new CodecError('rir without flag')
  if (x & EXT_WITH_PREV) entry.withPrev = true
  if (x & EXT_REST) {
    const steps = r.u8()
    if (steps > REST_STEPS_MAX) throw new CodecError('rest')
    entry.restSec = steps * REST_STEP
  }
  if (x & EXT_NOTE) {
    const note = r.str()
    if (!note) throw new CodecError('empty note')
    entry.note = note
  }
}

function readV1(r: ReturnType<typeof reader>, opts: DecodeOptions, version: number) {
  const makeId = opts.makeId ?? sequentialIds('e')
  const name = r.str()
  const trainMask = r.u8()
  const labelMask = r.u8()
  const labels = [0, 1, 2, 3, 4, 5, 6].map((i) => (labelMask & (1 << i) ? r.str() : undefined))
  const noteMask = r.u8()
  const notes = [0, 1, 2, 3, 4, 5, 6].map((i) => (noteMask & (1 << i) ? r.str() : undefined))
  if ((trainMask | labelMask | noteMask) > 0x7f) throw new CodecError('day mask')

  const customCount = r.varint()
  if (customCount > 64) throw new CodecError('too many custom exercises')
  const custom: CustomExercise[] = []
  for (let i = 0; i < customCount; i++) {
    const id = `c${r.u8()}`
    const cname = r.str()
    const laterality = LATERALITY[r.u8()]
    if (!laterality) throw new CodecError('laterality')
    const eqCount = r.varint()
    const equipment: string[] = []
    for (let k = 0; k < eqCount; k++) {
      const e = CODEC_EQUIPMENT_V1[r.u8()]
      if (!e) throw new CodecError('equipment')
      equipment.push(e)
    }
    const groupCount = r.varint()
    const groups: CustomExercise['groups'] = {}
    for (let k = 0; k < groupCount; k++) {
      const b = r.u8()
      const g = CODEC_GROUPS_V1[b >> 1]
      if (!g) throw new CodecError('group')
      groups[g] = b & 1 ? 'secondary' : 'primary'
    }
    custom.push({ id, name: cname, equipment, laterality, groups })
  }

  const days: Day[] = []
  for (let d = 0; d < 7; d++) {
    const count = r.varint()
    if (count > SHARE_DAY_ENTRIES_MAX) throw new CodecError('too many entries')
    const entries: Entry[] = []
    for (let k = 0; k < count; k++) {
      const head = r.u8()
      const repsKind = (head >> 1) & 3
      const ref: ExerciseRef = head & 1 ? `c${r.u8()}` : mapRetired(r.u16(), opts.replacedBy)
      const entry: Entry = { id: makeId(), exerciseId: ref, sets: (head >> 3) + 1 }
      if (repsKind === REPS_PRESET) {
        const reps = REPS_PRESETS[r.u8()]
        if (!reps) throw new CodecError('reps preset')
        entry.reps = reps
      } else if (repsKind === REPS_TEXT) entry.reps = r.str()
      else if (repsKind !== REPS_NONE) throw new CodecError('reps kind')
      if (version >= V2) readExtension(r, entry, version)
      entries.push(entry)
    }
    const day: Day = { kind: trainMask & (1 << d) ? 'train' : 'rest', entries: normalizeSupersets(entries) }
    if (labels[d] !== undefined) day.label = labels[d]
    if (notes[d] !== undefined) day.note = notes[d]
    days.push(day)
  }

  return { id: opts.id ?? 'shared', name, days, custom }
}
