import { resolveExercise, type ResolveContext } from '../../../domain/resolve'
import type { Program, Role } from '../../../domain/schema'

/** What the desktop map and board are pointing at: an entry's muscles, or one muscle group. */
export type Focus = { kind: 'entry'; groups: readonly string[] } | { kind: 'group'; group: string }

export type LitEntry = { id: string; day: number; role: Role }

/** Entries on training days that count toward a group, with the role the group plays in each. */
export function entriesTraining(program: Program, group: string, ctx: ResolveContext): LitEntry[] {
  const out: LitEntry[] = []
  program.days.forEach((d, day) => {
    if (d.kind !== 'train') return
    for (const e of d.entries) {
      const g = resolveExercise(e.exerciseId, ctx)?.groups[group]
      if (g && g.weight > 0) out.push({ id: e.id, day, role: g.role })
    }
  })
  return out
}

/** Groups with sets this week, most sets first. */
export function trainedGroups(weekly: Readonly<Record<string, number>>): string[] {
  return Object.entries(weekly)
    .filter(([, sets]) => sets > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([g]) => g)
}
