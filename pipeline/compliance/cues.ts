// Cue originality gate: fails when an exercise cue shares a word 7-gram with free-exercise-db or wger instruction
// text, or uses known third-party boilerplate. The corpus is cached in pipeline/.cache/compliance (gitignored) and
// must never be committed, printed or pasted into prompts.
// node pipeline/compliance/cues.ts [--refresh]
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { CACHE, DATA } from '../lib/paths.ts'
import { checkCue, ngrams, parseAllowlist, stripHtml } from './cue-rules.ts'

const DIR = path.join(CACHE, 'compliance')
const FEDB_COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5'
const FEDB_SHA256 = '5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf'
const FEDB_URL = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FEDB_COMMIT}/dist/exercises.json`
const WGER_URL = 'https://wger.de/api/v2/exercise-translation/?limit=100'
const WGER_ENGLISH = 2
const WGER_MAX_AGE_DAYS = 30
const USER_AGENT = 'gym-builder-compliance/1.0 (build-time cue originality check, cached, about 35 requests per month)'

const refresh = process.argv.includes('--refresh')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')

async function get(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) })
    } catch (e) {
      if (attempt >= 4) throw e
      console.log(`  ${(e as Error).message}, retrying in ${5 * attempt}s`)
      await sleep(5000 * attempt)
      continue
    }
    if (res.ok) return res
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`${url}: HTTP ${res.status}`)
    const wait = Number(res.headers.get('retry-after')) || 5 * attempt
    console.log(`  HTTP ${res.status}, retrying in ${wait}s`)
    await sleep(wait * 1000)
  }
}

async function freeExerciseDb(): Promise<string[]> {
  const file = path.join(DIR, `free-exercise-db-${FEDB_COMMIT.slice(0, 12)}.json`)
  if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== FEDB_SHA256) {
    console.log(`fetching free-exercise-db @ ${FEDB_COMMIT.slice(0, 12)}`)
    const buf = Buffer.from(await (await get(FEDB_URL)).arrayBuffer())
    if (sha256(buf) !== FEDB_SHA256) throw new Error(`free-exercise-db sha256 mismatch: ${sha256(buf)}`)
    fs.writeFileSync(file, buf)
  }
  const records = JSON.parse(fs.readFileSync(file, 'utf8')) as { instructions?: string[] }[]
  return records.flatMap((r) => r.instructions ?? [])
}

type WgerCache = { fetchedAt: string; descriptions: string[] }

async function fetchWger(): Promise<WgerCache> {
  const descriptions: string[] = []
  let url: string | null = WGER_URL
  for (let page = 1; url; page++) {
    if (page > 1) await sleep(1000)
    const body = (await (await get(url)).json()) as {
      count: number
      next: string | null
      results: { language: number; description: string }[]
    }
    for (const r of body.results) if (r.language === WGER_ENGLISH && r.description) descriptions.push(r.description)
    console.log(`  wger page ${page}/${Math.ceil(body.count / 100)}: ${descriptions.length} English descriptions`)
    url = body.next
  }
  return { fetchedAt: new Date().toISOString(), descriptions }
}

async function wger(): Promise<string[]> {
  const file = path.join(DIR, 'wger-en.json')
  const cached = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as WgerCache) : null
  const ageDays = cached ? (Date.now() - Date.parse(cached.fetchedAt)) / 86_400_000 : Infinity
  if (!refresh && cached && ageDays <= WGER_MAX_AGE_DAYS) return cached.descriptions
  try {
    console.log('fetching wger exercise descriptions (1 request per second)')
    const fresh = await fetchWger()
    fs.writeFileSync(file, JSON.stringify(fresh))
    return fresh.descriptions
  } catch (e) {
    if (!cached) throw e
    console.log(`  wger fetch failed (${(e as Error).message}), using the ${Math.round(ageDays)}-day-old cache`)
    return cached.descriptions
  }
}

fs.mkdirSync(DIR, { recursive: true })
const corpus = new Map<string, string>()
const add = (texts: string[], source: string) => {
  for (const t of texts) for (const g of ngrams(t)) if (!corpus.has(g)) corpus.set(g, source)
}
add(await freeExerciseDb(), 'free-exercise-db')
add((await wger()).map(stripHtml), 'wger')

const allow = parseAllowlist(fs.readFileSync(path.join(import.meta.dirname, 'cue-allowlist.txt'), 'utf8'))
const files = fs.readdirSync(path.join(DATA, 'exercises')).filter((f) => f.endsWith('.json')).sort()
let cues = 0
let failures = 0
for (const f of files) {
  const record = JSON.parse(fs.readFileSync(path.join(DATA, 'exercises', f), 'utf8')) as { cues?: string[] }
  for (const [i, cue] of (record.cues ?? []).entries()) {
    cues++
    const found = checkCue(cue, corpus, allow)
    if (!found.length) continue
    failures++
    console.log(`FAIL ${f} cue ${i + 1}: "${cue}"`)
    for (const x of found) {
      console.log(x.kind === 'ngram' ? `  shared 7-gram with ${x.source}: "${x.phrase}"` : `  boilerplate: "${x.phrase}"`)
    }
  }
}
console.log(`${cues} cues in ${files.length} exercises checked against ${corpus.size} third-party 7-grams: ${failures} failing`)
if (failures) process.exit(1)
