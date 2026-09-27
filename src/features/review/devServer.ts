import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import { parseManifest, type ManifestEntry } from './manifest.ts'
import { decide, isReviewFields, NOTE_MAX, readFields, RecordFormatError, writeFields } from './record.ts'
import { REVIEW_API, type DecisionResponse, type QueueResponse, type ReviewFields, type ReviewItem } from './types.ts'

// Dev-server-only endpoints for /dev/review. Writes nothing but qa.motion, qa.note and media.status of
// data/exercises/<id>-<slug>.json. Never part of a build (apply: serve).

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const BODY_LIMIT = 16 * 1024

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

// JSON-only and same-origin, so a page on another origin can't post decisions to a dev server on the LAN.
function assertSameOrigin(req: IncomingMessage) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'expected application/json')
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'cross-site request')
  const origin = req.headers.origin
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'cross-origin request')
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > BODY_LIMIT) throw new HttpError(413, 'body too large')
    chunks.push(chunk as Buffer)
  }
  try {
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    // falls through
  }
  throw new HttpError(400, 'invalid JSON body')
}

function toId(v: unknown): number {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535) return v
  throw new HttpError(400, 'invalid exercise id')
}

export function reviewPlugin(): Plugin {
  let root = process.cwd()
  /** files this middleware wrote, with the text it wrote: their change events skip HMR */
  const written = new Map<string, string>()

  const dir = {
    records: () => path.join(root, 'data/exercises'),
    baked: () => path.join(root, 'src/features/figure/motion/baked'),
    manifest: () => path.join(root, 'public/media/manifest.json'),
    sheet: (id: number) => path.join(root, `qa/out/animated/figure-${id}.png`),
  }

  function bakedIds(): number[] {
    if (!existsSync(dir.baked())) return []
    return readdirSync(dir.baked())
      .map((f) => Number(/^(\d+)-.*\.json$/.exec(f)?.[1]))
      .filter((n) => Number.isInteger(n) && n > 0)
  }

  function recordFile(id: number): string | null {
    const files = readdirSync(dir.records()).filter((f) => f.startsWith(`${id}-`) && f.endsWith('.json'))
    return files.length === 1 ? files[0] : null
  }

  function readRecord(id: number): { file: string; abs: string; text: string } {
    const file = recordFile(id)
    if (!file) throw new HttpError(404, `no single record file for exercise ${id}`)
    const abs = path.join(dir.records(), file)
    const text = readFileSync(abs, 'utf8')
    if ((JSON.parse(text) as { id?: unknown }).id !== id) throw new HttpError(409, `${file} does not hold exercise ${id}`)
    return { file, abs, text }
  }

  function publicFile(url: string): boolean {
    try {
      const abs = path.resolve(root, 'public', decodeURIComponent(url.split(/[?#]/)[0]).replace(/^\/+/, ''))
      return abs.startsWith(path.join(root, 'public') + path.sep) && existsSync(abs)
    } catch {
      return false
    }
  }

  function toItem(id: number, file: string, fields: ReviewFields, media: ManifestEntry | undefined): ReviewItem {
    const sheet = dir.sheet(id)
    const loop = media?.loop ?? null
    const found = loop !== null && publicFile(loop)
    return {
      id,
      file,
      loop: found ? loop : null,
      ...(loop && !found ? { loopMissing: loop } : {}),
      poster: media?.poster && publicFile(media.poster) ? media.poster : null,
      sheet: existsSync(sheet) ? `${REVIEW_API}/sheet/${id}.png?v=${Math.round(statSync(sheet).mtimeMs)}` : null,
      fields,
    }
  }

  function manifest(): { entries: ManifestEntry[]; error?: string; present: boolean } {
    if (!existsSync(dir.manifest())) return { entries: [], present: false }
    try {
      return { entries: parseManifest(JSON.parse(readFileSync(dir.manifest(), 'utf8'))), present: true }
    } catch (e) {
      return { entries: [], present: true, error: (e as Error).message }
    }
  }

  function queue(): QueueResponse {
    const baked = new Set(bakedIds())
    const m = manifest()
    const media = new Map(m.entries.map((e) => [e.id, e]))
    const ids = new Set([...m.entries.filter((e) => e.loop || baked.has(e.id)).map((e) => e.id), ...baked])
    const items: ReviewItem[] = []
    const missing: number[] = []
    for (const id of [...ids].sort((a, b) => a - b)) {
      try {
        const { file, text } = readRecord(id)
        items.push(toItem(id, file, readFields(text), media.get(id)))
      } catch {
        missing.push(id)
      }
    }
    return { source: m.present ? 'manifest' : 'baked', ...(m.error ? { manifestError: m.error } : {}), items, missing }
  }

  function write(id: number, next: (current: ReviewFields) => ReviewFields): DecisionResponse {
    const { file, abs, text } = readRecord(id)
    const previous = readFields(text)
    const fields = next(previous)
    const out = writeFields(text, fields)
    written.set(abs, out)
    writeFileSync(abs, out)
    const m = manifest()
    return { item: toItem(id, file, readFields(out), m.entries.find((e) => e.id === id)), previous }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://review.local')
    if (req.method === 'GET' && url.pathname === '/queue') return send(res, 200, queue())

    const sheet = /^\/sheet\/(\d+)\.png$/.exec(url.pathname)
    if (req.method === 'GET' && sheet) {
      const file = dir.sheet(Number(sheet[1]))
      if (!existsSync(file)) throw new HttpError(404, 'no contact sheet')
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'no-cache')
      return res.end(readFileSync(file))
    }

    if (req.method === 'POST' && url.pathname === '/decision') {
      assertSameOrigin(req)
      const body = await readJson(req)
      const id = toId(body.id)
      const decision = body.decision
      if (decision !== 'approved' && decision !== 'rejected') throw new HttpError(400, 'decision must be approved or rejected')
      const note = typeof body.note === 'string' ? body.note : ''
      if (note.length > NOTE_MAX) throw new HttpError(400, 'note too long')
      if (decision === 'rejected' && !note.trim()) throw new HttpError(400, 'a rejection needs a note')
      return send(res, 200, write(id, (current) => decide(current, decision, note)))
    }

    if (req.method === 'POST' && url.pathname === '/restore') {
      assertSameOrigin(req)
      const body = await readJson(req)
      const id = toId(body.id)
      if (!isReviewFields(body.fields)) throw new HttpError(400, 'invalid fields')
      const fields = body.fields
      return send(res, 200, write(id, () => fields))
    }

    throw new HttpError(404, 'unknown review endpoint')
  }

  return {
    name: 'gym-builder:review',
    apply: (_, env) => env.command === 'serve' && env.mode !== 'test',
    enforce: 'pre',
    configResolved(config) {
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use(REVIEW_API, (req, res) => {
        handle(req, res).catch((e: unknown) => {
          const status = e instanceof HttpError ? e.status : e instanceof RecordFormatError ? 409 : 500
          send(res, status, { error: e instanceof Error ? e.message : String(e) })
        })
      })
    },
    // A decision rewrites a record the catalog imports; without this the review page would reload after each one.
    async hotUpdate({ file, read }) {
      const mine = written.get(path.resolve(file))
      if (mine === undefined) return
      if ((await read()) === mine) return []
      written.delete(path.resolve(file))
    },
  }
}
