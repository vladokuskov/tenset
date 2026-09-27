import { NAME_MAX } from '../../domain/program'

/** "Push Pull Legs" -> "Push Pull Legs 2" when the name is taken (case-insensitive), within the name limit. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()))
  const base = name.trim().slice(0, NAME_MAX) || 'Shared program'
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; n < 1000; n++) {
    const suffix = ` ${n}`
    const candidate = `${base.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return base
}
