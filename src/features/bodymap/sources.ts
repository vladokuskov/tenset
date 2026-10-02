import raw from '../../../data/sources.json'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'
import { bodymapMessages } from './messages'

export type Source = { id: string; cite: string; use?: string }

const byId = new Map<string, Source>((raw.sources as Source[]).map((s) => [s.id, s]))

const EXPERT_OPINION = new Set(['rp-2023'])

export type Citation = { id: string; text: string; note?: string }

/** Citation text for a sourceId; "heuristic" and unknown ids get a plain note instead. Citations stay in English. */
export function citation(id: string, locale: Locale = getLocale()): Citation {
  const m = bodymapMessages[locale]
  if (id === 'heuristic') return { id, text: m.heuristic }
  const s = byId.get(id)
  if (!s) return { id, text: id }
  return { id, text: s.cite, note: EXPERT_OPINION.has(id) ? m.expertOpinion : undefined }
}
