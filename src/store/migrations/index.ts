export type Migration = (state: unknown) => unknown
/** Keyed by the version a step migrates from. */
export type MigrationChain = Readonly<Record<number, Migration>>

export const PROGRAMS_VERSION = 2
export const PREFS_VERSION = 1

// v0 is anything saved before a version was set (zustand's default); v1 kept the same shape.
// v2 added optional entry notes, so v1 data is already valid v2.
export const programMigrations: MigrationChain = {
  0: (state) => state,
  1: (state) => state,
}

export const prefsMigrations: MigrationChain = {
  0: (state) => state,
}

/**
 * Runs steps from `from` up to `to`. State from a newer app version is returned as is,
 * so schema validation decides whether it is usable.
 */
export function runMigrations(state: unknown, from: number, to: number, chain: MigrationChain): unknown {
  let s = state
  for (let v = from; v < to; v++) {
    const step = chain[v]
    if (!step) throw new Error(`No migration from v${v}`)
    s = step(s)
  }
  return s
}
