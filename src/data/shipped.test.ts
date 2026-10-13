import { describe, expect, it } from 'vitest'
import manifest from '../../public/media/manifest.json'
import { exercises } from './catalog.ts'
import { posterManifest, recordCues, shippedRecord } from './shipped.ts'

const RECORD = JSON.stringify({ id: 101, name: 'Bench', cues: ['One', 'Two', 'Three'], qa: { data: 'approved', motion: 'approved', note: 'long' } })

describe('shipped data', () => {
  it('moves cues and review notes out of the bundled records', () => {
    expect(JSON.parse(shippedRecord(RECORD))).toEqual({ id: 101, name: 'Bench', cues: [], qa: { data: 'approved', motion: 'approved' } })
    expect(JSON.parse(recordCues(RECORD))).toEqual({ id: 101, cues: ['One', 'Two', 'Three'] })
  })

  it('bundles catalog records without cues or review notes', () => {
    expect(exercises.length).toBeGreaterThan(250)
    for (const e of exercises) {
      expect(e.cues, e.slug).toEqual([])
      expect(e.qa.note, e.slug).toBeUndefined()
    }
  })

  it('bundles only the poster path from the media manifest', () => {
    const json = JSON.stringify({ 101: { poster: 'p/101.webp', loop: 'l/101.mp4', inputs: { body: 'x' } }, 102: { loop: 'l/102.mp4' } })
    expect(JSON.parse(posterManifest(json))).toEqual({ 101: { poster: 'p/101.webp' } })
    const entries = Object.values(manifest as Record<string, object>)
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) expect(Object.keys(entry)).toEqual(['poster'])
  })
})
