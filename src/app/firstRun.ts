import { programStore } from '../store/program.store'

/** Screens that need a program. Catalog, detail, settings, legal pages and /shared stay reachable. */
const GATED = [/^\/$/, /^\/day\//, /^\/body\/?$/]

export function hasAnyProgram(): boolean {
  return Object.keys(programStore.getState().programs).length > 0
}

export function needsWelcome(pathname: string, hasProgram = hasAnyProgram()): boolean {
  return !hasProgram && GATED.some((re) => re.test(pathname))
}
