import manifest from '../../../public/media/manifest.json'

// Baked posters (pipeline/render/bake-loops.ts) by exercise id. Bundled so list cards know the hashed file name
// without a request; the files themselves are precached by the service worker.

const byId = new Map<number, string>()
for (const [id, entry] of Object.entries(manifest as Record<string, { poster?: string }>)) {
  if (entry.poster) byId.set(Number(id), `/${entry.poster}`)
}

export function posterUrl(id: number | string): string | null {
  return typeof id === 'number' ? (byId.get(id) ?? null) : null
}
