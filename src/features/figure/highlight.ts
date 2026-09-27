import { headsOfGroup, isGroup, parentOf } from '../../domain/taxonomy'

// Worked-muscle highlight, drawn through the head-level atlas (atlas.ts, mask.ts).
export type HighlightRole = 'primary' | 'secondary'

/** taxonomy ids: group ids expand to their visible heads, deep heads draw on their visible parent */
export type FigureHighlight = {
  primary?: readonly string[]
  secondary?: readonly string[]
  /** only one side of the body (unilateral exercises); both when omitted */
  side?: 'l' | 'r'
}

export type ResolvedHighlight = { primary: Set<string>; secondary: Set<string>; side?: 'l' | 'r' }

export const highlightColors: Record<HighlightRole, string> = {
  primary: '#e2361a',
  secondary: '#f59a55',
}

export const noHighlight: FigureHighlight = {}

function expand(ids: readonly string[] | undefined, out: Set<string>) {
  for (const id of ids ?? []) {
    if (isGroup(id)) for (const h of headsOfGroup(id)) out.add(h)
    else out.add(parentOf(id) ?? id)
  }
}

/** Head ids per role; a head listed as both is primary. */
export function resolveHighlight(h: FigureHighlight | undefined): ResolvedHighlight {
  const primary = new Set<string>()
  const secondary = new Set<string>()
  expand(h?.primary, primary)
  expand(h?.secondary, secondary)
  for (const id of primary) secondary.delete(id)
  return { primary, secondary, side: h?.side }
}

export function isEmptyHighlight(h: FigureHighlight | undefined) {
  return !h?.primary?.length && !h?.secondary?.length
}

/** "biceps:p,brachialis:p,forearms:s,side=r" -> highlight (dev route and QA renders); a "head." prefix is ignored */
export function parseHighlight(spec: string): FigureHighlight {
  const primary: string[] = []
  const secondary: string[] = []
  let side: 'l' | 'r' | undefined
  for (const part of spec.split(',')) {
    const [raw, r] = part.trim().split(':')
    if (!raw) continue
    if (raw === 'side=l' || raw === 'side=r') side = raw === 'side=l' ? 'l' : 'r'
    else (r === 's' ? secondary : primary).push(raw.replace(/^head\./, ''))
  }
  return { primary, secondary, ...(side ? { side } : {}) }
}
