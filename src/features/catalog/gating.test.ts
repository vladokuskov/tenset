import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeExercises } from '../../data/catalog'
import type { Exercise } from '../../domain/schema'
import { motionIds } from '../figure/motion/library'
import { ExerciseCardMedia } from './ExerciseCardMedia'
import { showsMotion } from './media'

// Vite replaces import.meta.env.DEV with false in a production build; stubbing it renders what that build renders.
const card = (exercise: Exercise) => renderToStaticMarkup(createElement(ExerciseCardMedia, { exercise }))
const MAP = 'Muscles worked by'
const POSTER = '/media/posters/'

describe('baked media gating', () => {
  const baked = activeExercises.filter((e) => motionIds.includes(e.id))
  // synthetic fallbacks, so the fixtures hold once every record has a motion and every motion is approved
  const unapproved = baked.find((e) => e.media.status !== 'loop') ?? { ...baked[0], media: { ...baked[0].media, status: 'card' } }
  const approved: Exercise = { ...unapproved, media: { ...unapproved.media, status: 'loop' } }
  const noMotion: Exercise = { ...activeExercises[0], id: 65000, slug: 'no-motion' }

  beforeEach(() => {
    // the map card fetches its anatomy; keep it pending so nothing leaves the test
    vi.stubGlobal('fetch', () => new Promise(() => {}))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('shows the body map card for an unapproved exercise in a production build', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    expect(baked.length).toBeGreaterThan(0)
    for (const e of baked.filter((x) => x.media.status !== 'loop')) expect(showsMotion(e), e.slug).toBe(false)
    expect(card(unapproved)).toContain(MAP)
    expect(card(unapproved)).not.toContain(POSTER)
  })

  it('shows the poster once the loop is approved, and never without a baked motion', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    expect(card(approved)).toContain(`${POSTER}${approved.id}-`)
    expect(card({ ...noMotion, media: { ...noMotion.media, status: 'loop' } })).not.toContain(POSTER)
  })

  it('shows every baked motion in dev', () => {
    vi.stubEnv('DEV', true)
    expect(card(unapproved)).toContain(POSTER)
    expect(card(noMotion)).toContain(MAP)
  })
})
