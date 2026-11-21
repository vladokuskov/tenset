import manifest from '../../public/media/manifest.json'

// Baked posters and loops (pipeline/render/bake-loops.ts) by exercise id. Bundled so cards know the hashed file
// names without a request; the service worker caches each file on first view.

type Entry = { poster?: string; loop?: string }

const posters = new Map<number, string>()
const loops = new Map<number, string>()
for (const [id, entry] of Object.entries(manifest as Record<string, Entry>)) {
  if (entry.poster) posters.set(Number(id), `/${entry.poster}`)
  if (entry.loop) loops.set(Number(id), `/${entry.loop}`)
}

export function posterUrl(id: number | string): string | null {
  return typeof id === 'number' ? (posters.get(id) ?? null) : null
}

export function loopUrl(id: number | string): string | null {
  return typeof id === 'number' ? (loops.get(id) ?? null) : null
}
