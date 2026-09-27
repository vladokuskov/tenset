import raw from '../../../data/sources.json'

export type Source = { id: string; cite: string; use?: string }

const byId = new Map<string, Source>((raw.sources as Source[]).map((s) => [s.id, s]))

export const HEURISTIC_TEXT = 'A rule of thumb built into this app, not a study result.'
const EXPERT_OPINION = new Set(['rp-2023'])

export type Citation = { id: string; text: string; note?: string }

/** Citation text for a sourceId; "heuristic" and unknown ids get a plain note instead. */
export function citation(id: string): Citation {
  if (id === 'heuristic') return { id, text: HEURISTIC_TEXT }
  const s = byId.get(id)
  if (!s) return { id, text: id }
  return { id, text: s.cite, note: EXPERT_OPINION.has(id) ? 'Expert opinion' : undefined }
}
