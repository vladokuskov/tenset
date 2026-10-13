// Reads public/media/manifest.json leniently: the media bake owns its exact shape. Accepted: an array of entries, a
// record keyed by id or "<id>-<slug>", or either of those under exercises / entries / items / media. An entry names
// its loop as loop / video / mp4 and its poster as poster / webp, each a path string or an object with src / url /
// path / file. Relative paths resolve against /media/, the manifest's folder.

export type ManifestEntry = { id: number; loop: string | null; poster: string | null }

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

const CONTAINERS = ['exercises', 'entries', 'items', 'media']
const LOOP_KEYS = ['loop', 'video', 'mp4']
const POSTER_KEYS = ['poster', 'webp']
const PATH_KEYS = ['src', 'url', 'path', 'file']

function pathOf(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (isObj(v)) for (const k of PATH_KEYS) if (typeof v[k] === 'string' && v[k]) return v[k] as string
  return null
}

/** App-relative URL for a manifest path; null for anything on another origin. */
export function mediaUrl(p: string | null): string | null {
  if (!p || /^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//')) return null
  if (p.startsWith('/')) return p
  const rel = p.replace(/^\.\//, '').replace(/^public\//, '')
  return rel.startsWith('media/') ? `/${rel}` : `/media/${rel}`
}

function toId(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(/^(\d+)/.exec(v)?.[1]) : NaN
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

function entry(key: unknown, v: unknown): ManifestEntry | null {
  const id = toId(isObj(v) && v.id !== undefined ? v.id : key)
  if (id === null) return null
  const pick = (keys: string[]) => {
    if (!isObj(v)) return null
    for (const k of keys) {
      const p = mediaUrl(pathOf(v[k]))
      if (p) return p
    }
    return null
  }
  return { id, loop: pick(LOOP_KEYS), poster: pick(POSTER_KEYS) }
}

export function parseManifest(raw: unknown): ManifestEntry[] {
  let list: unknown = raw
  if (isObj(raw)) for (const k of CONTAINERS) if (Array.isArray(raw[k]) || isObj(raw[k])) {
    list = raw[k]
    break
  }
  const pairs: [unknown, unknown][] = Array.isArray(list) ? list.map((v) => [undefined, v]) : isObj(list) ? Object.entries(list) : []
  const byId = new Map<number, ManifestEntry>()
  for (const [k, v] of pairs) {
    const e = entry(k, v)
    if (e && !byId.has(e.id)) byId.set(e.id, e)
  }
  return [...byId.values()].sort((a, b) => a.id - b.id)
}
