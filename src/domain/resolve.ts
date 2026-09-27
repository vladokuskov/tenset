import type { CustomExercise, Exercise, ExerciseRef, Pattern, Prefs, Role } from './schema.ts'
import { allHeadsOfGroup, isGroup } from './taxonomy.ts'

export type Catalog = ReadonlyMap<number, Exercise>
export type Overrides = Prefs['overrides']
export type CountingModeValue = Prefs['countingMode']

export type ResolvedGroup = { role: Role; weight: number }

export type ResolvedExercise = {
  ref: ExerciseRef
  name: string
  custom: boolean
  /** A user override changed at least one group role. */
  overridden: boolean
  laterality: Exercise['laterality']
  equipment: string[]
  pattern: Pattern | null
  mechanic: Exercise['mechanic'] | null
  /** Effective roles after overrides; "none" groups are removed. Weight is 0 for secondary in primary-only mode. */
  groups: Record<string, ResolvedGroup>
  /** Emphasis for every visible and deep head of every listed group (omitted heads = 1). */
  heads: Record<string, number>
}

export type ResolveContext = {
  catalog: Catalog
  custom: readonly CustomExercise[]
  countingMode: CountingModeValue
  overrides: Overrides
}

export const ROLE_WEIGHT = { primary: 1, secondary: 0.5 } as const

export function roleWeight(role: Role, countingMode: CountingModeValue): number {
  if (role === 'secondary' && countingMode === 'primary') return 0
  return ROLE_WEIGHT[role]
}

export function isCustomRef(ref: ExerciseRef): ref is string {
  return typeof ref === 'string'
}

export function resolveExercise(ref: ExerciseRef, ctx: ResolveContext): ResolvedExercise | null {
  if (isCustomRef(ref)) {
    const c = ctx.custom.find((x) => x.id === ref)
    if (!c) return null
    return build(ref, ctx, {
      name: c.name,
      custom: true,
      laterality: c.laterality,
      equipment: [...c.equipment],
      pattern: null,
      mechanic: null,
      baseGroups: c.groups,
      emphasis: {},
    })
  }
  const ex = ctx.catalog.get(ref)
  if (!ex) return null
  return build(ref, ctx, {
    name: ex.name,
    custom: false,
    laterality: ex.laterality,
    equipment: [...ex.equipment],
    pattern: ex.pattern,
    mechanic: ex.mechanic,
    baseGroups: ex.groups,
    emphasis: ex.heads ?? {},
  })
}

type Base = Omit<ResolvedExercise, 'ref' | 'overridden' | 'groups' | 'heads'> & {
  baseGroups: Record<string, Role>
  emphasis: Record<string, number>
}

function build(ref: ExerciseRef, ctx: ResolveContext, base: Base): ResolvedExercise {
  const roles: Record<string, Role> = { ...base.baseGroups }
  let overridden = false
  for (const [group, role] of Object.entries(ctx.overrides[String(ref)] ?? {})) {
    if (!isGroup(group)) continue
    if (role === 'none') {
      if (group in roles) {
        delete roles[group]
        overridden = true
      }
    } else if (roles[group] !== role) {
      roles[group] = role
      overridden = true
    }
  }

  const groups: Record<string, ResolvedGroup> = {}
  const heads: Record<string, number> = {}
  for (const [group, role] of Object.entries(roles)) {
    if (!isGroup(group)) continue
    groups[group] = { role, weight: roleWeight(role, ctx.countingMode) }
    for (const h of allHeadsOfGroup(group)) heads[h] = base.emphasis[h] ?? 1
  }

  return {
    ref,
    name: base.name,
    custom: base.custom,
    overridden,
    laterality: base.laterality,
    equipment: base.equipment,
    pattern: base.pattern,
    mechanic: base.mechanic,
    groups,
    heads,
  }
}
