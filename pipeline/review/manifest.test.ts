import { describe, expect, it } from 'vitest'
import { mediaUrl, parseManifest } from './manifest.ts'

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
