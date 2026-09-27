import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mediaUrl, parseManifest } from './manifest'
import { countByStatus, pick, step } from './queue'
import { decide, isReviewFields, readFields, RecordFormatError, writeFields } from './record'
import type { ReviewItem } from './types'

const DIR = path.resolve(import.meta.dirname, '../../../data/exercises')
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
const text = (f: string) => readFileSync(path.join(DIR, f), 'utf8')
const curl = files.find((f) => f.startsWith('711-'))!

/** lines of b that differ from a, after the common head and tail */
function changedLines(a: string, b: string) {
  const x = a.split('\n')
  const y = b.split('\n')
  let head = 0
  while (head < x.length && x[head] === y[head]) head++
  let tail = 0
  while (tail < x.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++
  return y.slice(head, y.length - tail).filter((l) => !x.slice(head, x.length - tail).includes(l))
}

describe('record edits', () => {
  it('reads and rewrites every record byte for byte', () => {
    for (const f of files) {
      const t = text(f)
      expect(writeFields(t, readFields(t)), f).toBe(t)
    }
  })

  it('approval writes qa.motion, qa.note and media.status and nothing else', () => {
    const t = text(curl)
    const out = writeFields(t, decide(readFields(t), 'approved', '  Wrists look right  '))
    const before = JSON.parse(t)
    const after = JSON.parse(out)
    expect(after.qa).toEqual({ ...before.qa, motion: 'approved', note: 'Wrists look right' })
    expect(after.media.status).toBe('loop')
    expect({ ...after, qa: before.qa, media: { ...after.media, status: before.media.status } }).toEqual(before)
    expect(Object.keys(after)).toEqual(Object.keys(before))
    expect(changedLines(t, out)).toEqual(['    "status": "loop",', '    "motion": "approved",', '    "note": "Wrists look right"'])
  })

  it('rejection keeps media.status and an empty note removes qa.note', () => {
    const t = writeFields(text(curl), { motion: 'approved', note: 'ok', mediaStatus: 'loop' })
    const rejected = writeFields(t, decide(readFields(t), 'rejected', 'Elbows drift forward'))
    expect(readFields(rejected)).toEqual({ motion: 'rejected', note: 'Elbows drift forward', mediaStatus: 'loop' })
    expect(readFields(writeFields(t, decide(readFields(t), 'approved', ' ')))).toEqual({ motion: 'approved', mediaStatus: 'loop' })
  })

  it('restoring the previous fields gives back the original file', () => {
    const t = text(curl)
    const previous = readFields(t)
    const decided = writeFields(t, decide(previous, 'approved', 'note'))
    expect(writeFields(decided, previous)).toBe(t)
  })

  it('refuses records that are not canonically formatted', () => {
    const t = text(curl)
    expect(() => writeFields(t.replace('"id": 711', '"id":711'), readFields(t))).toThrow(RecordFormatError)
    expect(() => readFields('{')).toThrow(RecordFormatError)
    expect(() => writeFields(t, { motion: 'done' as never, mediaStatus: 'loop' })).toThrow(RecordFormatError)
  })

  it('keeps a different indent and CRLF line endings', () => {
    const rec = { id: 1, qa: { data: 'pending', motion: 'pending' }, media: { status: 'card' } }
    const t = JSON.stringify(rec, null, 4).replace(/\n/g, '\r\n') + '\r\n'
    const out = writeFields(t, { motion: 'approved', mediaStatus: 'loop' })
    expect(out).toBe(JSON.stringify({ ...rec, qa: { data: 'pending', motion: 'approved' }, media: { status: 'loop' } }, null, 4).replace(/\n/g, '\r\n') + '\r\n')
  })

  it('validates restore payloads', () => {
    expect(isReviewFields({ motion: 'pending', mediaStatus: 'card' })).toBe(true)
    expect(isReviewFields({ motion: 'pending', mediaStatus: 'card', note: 3 })).toBe(false)
    expect(isReviewFields({ motion: 'maybe', mediaStatus: 'card' })).toBe(false)
  })
})

describe('media manifest', () => {
  it('reads a record keyed by id with media/ paths', () => {
    const m = parseManifest({
      '711': { poster: 'media/posters/711-abc.webp', loop: 'media/loops/711-abc.mp4', hash: 'abc' },
      '203': { poster: 'media/posters/203-def.webp' },
    })
    expect(m).toEqual([
      { id: 203, loop: null, poster: '/media/posters/203-def.webp' },
      { id: 711, loop: '/media/loops/711-abc.mp4', poster: '/media/posters/711-abc.webp' },
    ])
  })

  it('reads arrays, containers, slug keys and nested paths', () => {
    expect(parseManifest([{ id: 5, video: { src: 'loops/5.mp4' } }])).toEqual([{ id: 5, loop: '/media/loops/5.mp4', poster: null }])
    expect(parseManifest({ exercises: { '7-curl': { mp4: '/media/loops/7.mp4' } } })).toEqual([{ id: 7, loop: '/media/loops/7.mp4', poster: null }])
    expect(parseManifest({ version: 1 })).toEqual([])
    expect(parseManifest(null)).toEqual([])
  })

  it('never points at another origin', () => {
    expect(mediaUrl('https://cdn.example/loop.mp4')).toBeNull()
    expect(mediaUrl('//cdn.example/loop.mp4')).toBeNull()
    expect(mediaUrl('public/media/loops/1.mp4')).toBe('/media/loops/1.mp4')
  })
})

describe('review queue', () => {
  const item = (id: number, motion: ReviewItem['fields']['motion']): ReviewItem => ({
    id, file: `${id}-x.json`, loop: null, poster: null, sheet: null, fields: { motion, mediaStatus: 'card' },
  })
  const items = [item(1, 'pending'), item(2, 'approved'), item(3, 'pending'), item(4, 'rejected'), item(5, 'pending')]

  it('steps through the filter in id order and wraps', () => {
    expect(step(items, 1, 'pending', 1)).toBe(3)
    expect(step(items, 5, 'pending', 1)).toBe(1)
    expect(step(items, 1, 'pending', -1)).toBe(5)
    expect(step(items, 2, 'pending', 1)).toBe(3)
    expect(step(items, 4, 'rejected', 1)).toBeNull()
    expect(step(items, null, 'all', -1)).toBe(5)
  })

  it('picks the requested item or the first in the filter', () => {
    expect(pick(items, 4, 'pending')?.id).toBe(4)
    expect(pick(items, undefined, 'approved')?.id).toBe(2)
    expect(pick(items, 99, 'rejected')?.id).toBe(4)
    expect(countByStatus(items)).toEqual({ pending: 3, approved: 1, rejected: 1, all: 5 })
  })
})
