import { Cable, Cog, Dumbbell, PersonStanding, type LucideIcon } from 'lucide-react'
import type { CustomExercise, Exercise, Role } from '../../domain/schema'
import { getGroup, visibleHeads } from '../../domain/taxonomy'
import { hasMotion } from '../figure/motion/library'

export type CardExercise = Exercise | CustomExercise

export function isCatalogExercise(e: CardExercise): e is Exercise {
  return typeof e.id === 'number'
}

/**
 * Whether the live figure, poster or loop may show instead of the M1 card: production only for owner-approved
 * loops (media.status "loop"), dev for every baked motion.
 */
export function showsMotion(e: CardExercise, dev: boolean = import.meta.env.DEV): boolean {
  return isCatalogExercise(e) && hasMotion(e.id) && (dev || e.media.status === 'loop')
}

const FREE_WEIGHTS = new Set(['barbell', 'dumbbell', 'ez_bar', 'plate'])
const BODYWEIGHT = new Set(['pullup_bar', 'dip_station', 'step', 'flat_bench', 'adjustable_bench', 'rack'])

export function equipmentGlyph(equipment: readonly string[]): { icon: LucideIcon; label: string } {
  if (equipment.includes('cable')) return { icon: Cable, label: 'Cable' }
  if (equipment.some((e) => FREE_WEIGHTS.has(e))) return { icon: Dumbbell, label: 'Free weights' }
  if (equipment.every((e) => BODYWEIGHT.has(e))) return { icon: PersonStanding, label: 'Bodyweight' }
  return { icon: Cog, label: 'Machine' }
}

const frontGroups = new Set(visibleHeads.filter((h) => h.view !== 'B').map((h) => h.group))
const backGroups = new Set(visibleHeads.filter((h) => h.view !== 'F').map((h) => h.group))

/** The view that shows the most primary groups (catalog records carry media.mapView). */
export function cardView(e: CardExercise, roles: Readonly<Record<string, Role>>): 'front' | 'back' {
  if (isCatalogExercise(e)) return e.media.mapView === 'B' ? 'back' : 'front'
  const primaries = Object.entries(roles).filter(([, r]) => r === 'primary').map(([g]) => g)
  const front = primaries.filter((g) => frontGroups.has(g)).length
  const back = primaries.filter((g) => backGroups.has(g)).length
  return back > front ? 'back' : 'front'
}

/** Body area most primaries sit in, used to crop small posters. */
export function primaryArea(roles: Readonly<Record<string, Role>>): 'upper' | 'core' | 'lower' {
  const count = { upper: 0, core: 0, lower: 0 }
  for (const [g, r] of Object.entries(roles)) {
    const area = getGroup(g)?.area
    if (r === 'primary' && area) count[area]++
  }
  if (count.lower > count.upper && count.lower >= count.core) return 'lower'
  if (count.core > count.upper) return 'core'
  return 'upper'
}

export function primaryGroupNames(roles: Readonly<Record<string, Role>>): string[] {
  return Object.entries(roles)
    .filter(([, r]) => r === 'primary')
    .map(([g]) => getGroup(g)?.name ?? g)
}
