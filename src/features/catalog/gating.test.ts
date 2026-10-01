import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeExercises } from '../../data/catalog'
import type { Exercise } from '../../domain/schema'
import { motionIds } from '../figure/motion/library'
import { ExerciseCardMedia } from './ExerciseCardMedia'
import { ExerciseMedia } from './ExerciseMotion'
import { showsMotion } from './media'

// Vite replaces import.meta.env.DEV with false in a production build; stubbing it renders what that build renders.
const render = (exercise: Exercise) => renderToStaticMarkup(createElement(ExerciseMedia, { exercise }))
const CARD = 'Muscles worked by'
const PLAYER = 'Position in the rep'
const card = (exercise: Exercise, size: 'sm' | 'md') => renderToStaticMarkup(createElement(ExerciseCardMedia, { exercise, size }))
const POSTER = '/media/posters/'

describe('baked media gating', () => {
  const baked = activeExercises.filter((e) => motionIds.includes(e.id))
  // synthetic fallbacks, so the fixtures hold once every record has a motion and every motion is approved
  const unapproved = baked.find((e) => e.media.status !== 'loop') ?? { ...baked[0], media: { ...baked[0].media, status: 'card' } }
  const approved: Exercise = { ...unapproved, media: { ...unapproved.media, status: 'loop' } }
  const noMotion: Exercise = { ...activeExercises[0], id: 65000, slug: 'no-motion' }

  beforeEach(() => {
    // the M1 card fetches its map; keep it pending so nothing leaves the test
    vi.stubGlobal('fetch', () => new Promise(() => {}))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('shows the M1 card for an unapproved exercise in a production build', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    expect(baked.length).toBeGreaterThan(0)
    for (const e of baked.filter((x) => x.media.status !== 'loop')) expect(showsMotion(e), e.slug).toBe(false)
    const html = render(unapproved)
    expect(html).toContain(CARD)
    expect(html).not.toContain(PLAYER)
  })

  it('shows the live figure in production once the loop is approved', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    expect(showsMotion(approved)).toBe(true)
    expect(render(approved)).toContain(PLAYER)
    expect(showsMotion({ ...noMotion, media: { ...noMotion.media, status: 'loop' } })).toBe(false)
  })

  it('shows every baked motion in dev', () => {
    vi.stubEnv('DEV', true)
    expect(showsMotion(unapproved)).toBe(true)
    expect(render(unapproved)).toContain(PLAYER)
    expect(render(noMotion)).not.toContain(PLAYER)
  })

  it('shows the baked poster on list and grid cards only where the motion may show', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    for (const size of ['sm', 'md'] as const) {
      expect(card(approved, size)).toContain(`${POSTER}${approved.id}-`)
      expect(card(unapproved, size)).not.toContain(POSTER)
    }
    expect(card({ ...noMotion, media: { ...noMotion.media, status: 'loop' } }, 'md')).not.toContain(POSTER)
    vi.stubEnv('DEV', true)
    expect(card(unapproved, 'md')).toContain(POSTER)
  })
})
