import type { Decision, MediaStatus, QaStatus, ReviewFields } from './types.ts'

// Edits an exercise record as text: only qa.motion, qa.note and media.status change, everything else stays
// byte-for-byte. Records that don't round-trip through JSON.stringify with their own indent are refused, not
// reformatted.

const QA: readonly QaStatus[] = ['pending', 'approved', 'rejected']
const MEDIA: readonly MediaStatus[] = ['card', 'still', 'loop']
export const NOTE_MAX = 2000

export class RecordFormatError extends Error {}

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function indentOf(text: string): string {
  return /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? '  '
}

function serialize(value: unknown, indent: string, eol: string): string {
  const out = JSON.stringify(value, null, indent) + '\n'
  return eol === '\n' ? out : out.replace(/\n/g, eol)
}

function parse(text: string): { rec: Json; qa: Json; media: Json; indent: string; eol: string } {
  let rec: unknown
  try {
    rec = JSON.parse(text)
  } catch (e) {
    throw new RecordFormatError(`not valid JSON: ${(e as Error).message}`)
  }
  if (!isObj(rec) || !isObj(rec.qa) || !isObj(rec.media)) throw new RecordFormatError('record has no qa or media object')
  const indent = indentOf(text)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  if (serialize(rec, indent, eol) !== text) throw new RecordFormatError('record formatting is not canonical JSON, refusing to rewrite it')
  return { rec, qa: rec.qa, media: rec.media, indent, eol }
}

export function readFields(text: string): ReviewFields {
  const { qa, media } = parse(text)
  const motion = QA.find((s) => s === qa.motion)
  const mediaStatus = MEDIA.find((s) => s === media.status)
  if (!motion || !mediaStatus) throw new RecordFormatError('qa.motion or media.status has an unknown value')
  return typeof qa.note === 'string' ? { motion, note: qa.note, mediaStatus } : { motion, mediaStatus }
}

/** Writes the three review fields; an empty note removes qa.note. */
export function writeFields(text: string, next: ReviewFields): string {
  if (!QA.includes(next.motion) || !MEDIA.includes(next.mediaStatus)) throw new RecordFormatError('unknown status value')
  const { rec, qa, media, indent, eol } = parse(text)
  qa.motion = next.motion
  const note = next.note?.trim()
  if (note) qa.note = note.slice(0, NOTE_MAX)
  else delete qa.note
  media.status = next.mediaStatus
  return serialize(rec, indent, eol)
}

/** Approval ships the loop (media.status "loop"); a rejection leaves media.status as it is. */
export function decide(current: ReviewFields, decision: Decision, note: string): ReviewFields {
  const trimmed = note.trim()
  return {
    motion: decision,
    ...(trimmed ? { note: trimmed.slice(0, NOTE_MAX) } : {}),
    mediaStatus: decision === 'approved' ? 'loop' : current.mediaStatus,
  }
}

export function isReviewFields(v: unknown): v is ReviewFields {
  return (
    isObj(v) &&
    QA.includes(v.motion as QaStatus) &&
    MEDIA.includes(v.mediaStatus as MediaStatus) &&
    (v.note === undefined || (typeof v.note === 'string' && v.note.length <= NOTE_MAX))
  )
}
