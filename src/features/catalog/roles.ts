import type { Prefs, Role } from '../../domain/schema'

export type GroupOverride = Prefs['overrides'][string]

/** Catalog group roles with the user's "Edit how this counts" changes applied. */
export function applyOverride(groups: Readonly<Record<string, Role>>, override: GroupOverride | undefined): Record<string, Role> {
  const roles: Record<string, Role> = { ...groups }
  if (!override) return roles
  for (const [g, r] of Object.entries(override)) {
    if (r === 'none') delete roles[g]
    else roles[g] = r
  }
  return roles
}

/** True when an override actually changes something (stale entries equal to the default do not count). */
export function isCustomized(groups: Readonly<Record<string, Role>>, override: GroupOverride | undefined): boolean {
  if (!override) return false
  return Object.entries(override).some(([g, r]) => (r === 'none' ? g in groups : groups[g] !== r))
}
