// Cue originality gate: fails when an exercise cue shares a word 7-gram with free-exercise-db or wger instruction
// text, or uses known third-party boilerplate. Both corpora are pinned repository files (wger's robots.txt disallows
// its API), cached in pipeline/.cache/compliance (gitignored), and must never be committed, printed or pasted into
// prompts.
// node pipeline/compliance/cues.ts
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { CACHE, DATA } from '../lib/paths.ts'
import { checkCue, ngrams, parseAllowlist, stripHtml } from './cue-rules.ts'

const DIR = path.join(CACHE, 'compliance')
const FEDB_COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5'
const FEDB_SHA256 = '5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf'
const FEDB_URL = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FEDB_COMMIT}/dist/exercises.json`
const WGER_COMMIT = '62161689c756ee36308e20133ab722833e121654'
const WGER_SHA256 = 'e76dc38796fa4e002855832209772535aac819043c348a88a98fe3949596c207'
const WGER_URL = `https://raw.githubusercontent.com/wger-project/wger/${WGER_COMMIT}/wger/exercises/fixtures/translations.json`
// wger/core/fixtures/languages.json
const WGER_ENGLISH = 2
const USER_AGENT = 'gym-builder-compliance/1.0 (build-time cue originality check, cached)'

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

/** A file pinned to a commit and sha256, downloaded once into the cache. */
async function pinned(name: string, commit: string, url: string, expected: string): Promise<string> {
  const file = path.join(DIR, `${name}-${commit.slice(0, 12)}.json`)
  if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== expected) {
    console.log(`fetching ${name} @ ${commit.slice(0, 12)}`)
    const buf = Buffer.from(await (await get(url)).arrayBuffer())
    if (sha256(buf) !== expected) throw new Error(`${name} sha256 mismatch: ${sha256(buf)}`)
    fs.writeFileSync(file, buf)
  }
  return fs.readFileSync(file, 'utf8')
}

async function freeExerciseDb(): Promise<string[]> {
  const records = JSON.parse(await pinned('free-exercise-db', FEDB_COMMIT, FEDB_URL, FEDB_SHA256)) as { instructions?: string[] }[]
  return records.flatMap((r) => r.instructions ?? [])
}

type WgerRow = { model: string; pk: number; fields: Record<string, unknown> }

/** English exercise descriptions and their comments from wger's translation fixture. */
async function wger(): Promise<string[]> {
  const rows = JSON.parse(await pinned('wger-translations', WGER_COMMIT, WGER_URL, WGER_SHA256)) as WgerRow[]
  const english = new Set<number>()
  const texts: string[] = []
  for (const r of rows) {
    if (r.model !== 'exercises.translation' || r.fields.language !== WGER_ENGLISH) continue
    english.add(r.pk)
    if (typeof r.fields.description === 'string' && r.fields.description) texts.push(r.fields.description)
  }
  for (const r of rows) {
    if (r.model !== 'exercises.exercisecomment' || !english.has(Number(r.fields.translation))) continue
    if (typeof r.fields.comment === 'string' && r.fields.comment) texts.push(r.fields.comment)
  }
  return texts
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
