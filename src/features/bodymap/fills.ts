import { groupShade, headShade, ROLE_COLOR, VOLUME_COLOR, type MapScale } from '../../app/volumeScale'
import type { Role } from '../../domain/schema'
import { deepHeadsOf, headsOfGroup, visibleHeads } from '../../domain/taxonomy'
import type { FigureVars } from './AnatomyFigure'

export const REST_FILL = 'var(--gb-rest,var(--color-vol-none))'
export const UNTRACKED_FILL = 'color-mix(in oklab, var(--color-vol-none) 45%, var(--color-map-skin))'

/** Primary-group heads below full emphasis get a tint between the two role colors. */
export const ROLE_MID = 'color-mix(in oklab, var(--color-role-primary) 55%, var(--color-role-secondary))'

export type BodyValues = {
  heads: Readonly<Record<string, number>>
  groups: Readonly<Record<string, number>>
}

export type BodyTint = {
  /** Group roles after overrides. */
  groups: Readonly<Record<string, Role>>
  /** Head emphasis inside listed groups (omitted heads count as 1). */
  heads?: Readonly<Record<string, number>>
}

/** Volume fills: --g-<group> in groups mode, --h-<head> for every visible head in heads mode. */
export function valueVars(values: BodyValues, shade: 'groups' | 'heads', scale: MapScale): FigureVars {
  const vars: FigureVars = {}
  if (shade === 'heads') {
    for (const h of visibleHeads) vars[`--h-${h.id}`] = VOLUME_COLOR[headShade(h.id, values.heads[h.id] ?? 0, scale)]
    return vars
  }
  for (const [g, sets] of Object.entries(values.groups)) vars[`--g-${g}`] = VOLUME_COLOR[groupShade(g, sets, scale)]
  return vars
}

/**
 * Exercise tint: primary strong, secondary light. Inside a primary group, heads at full emphasis stay
 * strong, heads at 0.5 or more take the mid tint and lighter ones the light tint. Deep heads draw on
 * their visible parent at the higher of the two emphases, like the volume map.
 */
export function tintVars({ groups, heads }: BodyTint): FigureVars {
  const vars: FigureVars = {}
  const emphasis = (h: string) => heads?.[h] ?? 1
  for (const [g, role] of Object.entries(groups)) {
    vars[`--g-${g}`] = ROLE_COLOR[role]
    if (!heads) continue
    for (const h of headsOfGroup(g)) {
      const e = Math.max(emphasis(h), ...deepHeadsOf(h).map(emphasis))
      if (e <= 0) vars[`--h-${h}`] = REST_FILL
      else if (role === 'primary' && e < 1) vars[`--h-${h}`] = e >= 0.5 ? ROLE_MID : ROLE_COLOR.secondary
    }
  }
  return vars
}

export function regionFill(group?: string, head?: string, untracked?: string): string {
  if (untracked || !group) return `var(--gb-untracked,${UNTRACKED_FILL})`
  return head ? `var(--h-${head},var(--g-${group},${REST_FILL}))` : `var(--g-${group},${REST_FILL})`
}

/** Group-level fills for mini maps: role tint when given, else volume. */
export function miniVars(
  groups: Readonly<Record<string, number>> | undefined,
  roles: Readonly<Record<string, Role>> | undefined,
  scale: MapScale,
): FigureVars {
  const vars: FigureVars = {}
  if (roles) {
    for (const [g, r] of Object.entries(roles)) vars[`--g-${g}`] = ROLE_COLOR[r]
    return vars
  }
  for (const [g, sets] of Object.entries(groups ?? {})) {
    if (sets > 0) vars[`--g-${g}`] = VOLUME_COLOR[groupShade(g, sets, scale)]
  }
  return vars
}
