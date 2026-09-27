import { describe, expect, it } from 'vitest'
import { checkMedia, mediaJobs, readManifest, stableJson } from './media.ts'

describe('baked exercise media', () => {
  const jobs = mediaJobs()

  it('is fresh for every shipped motion (re-bake with node pipeline/render/bake-loops.ts)', () => {
    expect(checkMedia(jobs)).toEqual([])
  })

  it('flags a record change as stale and names the input', () => {
    const manifest = structuredClone(readManifest())
    const id = String(jobs[0].id)
    manifest[id] = { ...manifest[id], hash: '000000000000', inputs: { ...manifest[id].inputs, record: 'deadbeef' } }
    expect(checkMedia(jobs, manifest).join('\n')).toMatch(new RegExp(`^${jobs[0].slug}: stale media, record changed`, 'm'))
  })

  it('flags missing entries and entries without a motion', () => {
    const manifest = structuredClone(readManifest())
    const id = String(jobs[0].id)
    manifest['65000'] = manifest[id]
    delete manifest[id]
    const issues = checkMedia(jobs, manifest).join('\n')
    expect(issues).toContain(`${jobs[0].slug}: no baked media`)
    expect(issues).toContain('manifest entry 65000 has no baked motion')
  })

  it('hashes objects independently of key order', () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe(stableJson({ a: [{ d: 2 }], b: 1 }))
  })
})
