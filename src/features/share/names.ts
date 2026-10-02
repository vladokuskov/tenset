import { NAME_MAX } from '../../domain/program'
import { getMessages } from '../../i18n/messages'
import { shareMessages } from './messages'

/** "Push Pull Legs" -> "Push Pull Legs 2" when the name is taken (case-insensitive), within the name limit. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()))
  const base = name.trim().slice(0, NAME_MAX) || getMessages(shareMessages).sharedProgram
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; n < 1000; n++) {
    const suffix = ` ${n}`
    const candidate = `${base.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return base
}
