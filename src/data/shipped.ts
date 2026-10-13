// Build transforms for the data the app bundles (wired up in vite.config.ts). Each takes and returns JSON text.

type JsonRecord = { id: number; cues?: unknown; qa?: { note?: string } }

/** Exercise record as bundled: cues ship in their own lazy chunk and review notes stay out. */
export function shippedRecord(json: string): string {
  const record = JSON.parse(json) as JsonRecord
  delete record.qa?.note
  return JSON.stringify({ ...record, cues: [] })
}

/** Just the id and cues of an exercise record, for the lazy cue chunk. */
export function recordCues(json: string): string {
  const { id, cues } = JSON.parse(json) as JsonRecord
  return JSON.stringify({ id, cues })
}

/** The media manifest without loops, hashes and bake inputs: list cards only need each poster path. */
export function posterManifest(json: string): string {
  const manifest = JSON.parse(json) as Record<string, { poster?: string }>
  const out: Record<string, { poster: string }> = {}
  for (const [id, entry] of Object.entries(manifest)) if (entry.poster) out[id] = { poster: entry.poster }
  return JSON.stringify(out)
}
