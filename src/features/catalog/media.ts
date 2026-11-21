import { Cable, Cog, Dumbbell, PersonStanding, Spline, type LucideIcon } from 'lucide-react'
import type { Exercise, Role } from '../../domain/schema'
import { groupName } from '../../data/localize'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'
import { hasMotion } from '../figure/motion/library'
import { catalogMessages } from './messages'

/**
 * Whether the poster and loop may show instead of the body map card: production only for owner-approved loops
 * (media.status "loop"), dev for every baked motion.
 */
export function showsMotion(e: Exercise, dev: boolean = import.meta.env.DEV): boolean {
  return hasMotion(e.id) && (dev || e.media.status === 'loop')
}

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const FREE_WEIGHTS = new Set(['barbell', 'dumbbell', 'ez_bar', 'plate', 'kettlebell', 'trap_bar', 'landmine'])
const BODYWEIGHT = new Set(['pullup_bar', 'dip_station', 'step', 'flat_bench', 'adjustable_bench', 'rack', 'rings', 'ab_wheel', 'ghd'])

export function equipmentGlyph(equipment: readonly string[], locale: Locale = getLocale()): { icon: LucideIcon; label: string } {
  const m = catalogMessages[locale].glyph
  if (equipment.includes('cable')) return { icon: Cable, label: m.cable }
  if (equipment.some((e) => FREE_WEIGHTS.has(e))) return { icon: Dumbbell, label: m.free }
  if (equipment.includes('band')) return { icon: Spline, label: m.band }
  if (equipment.every((e) => BODYWEIGHT.has(e))) return { icon: PersonStanding, label: m.bodyweight }
  return { icon: Cog, label: m.machine }
}

/** The body map view that shows the exercise's muscles best. */
export function cardView(e: Exercise): 'front' | 'back' {
  return e.media.mapView === 'B' ? 'back' : 'front'
}

export function primaryGroupNames(roles: Readonly<Record<string, Role>>, locale: Locale = getLocale()): string[] {
  return Object.entries(roles)
    .filter(([, r]) => r === 'primary')
    .map(([g]) => groupName(g, locale))
}
