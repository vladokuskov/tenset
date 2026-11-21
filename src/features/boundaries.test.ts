import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const FEATURES = import.meta.dirname

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return modules(p)
    return /\.tsx?$/.test(e.name) ? [p] : []
  })
}

const specifiers = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1])

const featureOf = (file: string) => path.relative(FEATURES, file).split(path.sep)[0]

function crossImports(test: (from: string, to: string, rest: string) => boolean): string[] {
  return modules(FEATURES).flatMap((file) => {
    const from = featureOf(file)
    return specifiers(file).flatMap((s) => {
      if (!s.startsWith('.')) return []
      const target = path.resolve(path.dirname(file), s)
      const rel = path.relative(FEATURES, target).split(path.sep)
      if (rel[0] === '..' || rel[0] === from) return []
      return test(from, rel[0], rel.slice(1).join('/')) ? [`${path.relative(FEATURES, file)} -> ${s}`] : []
    })
  })
}

// Older reaches into another feature, to move behind an index or into shared. Nothing new goes here.
const KNOWN = new Set([
  'catalog -> figure/motion/library',
  'review -> figure/highlight',
  'review -> figure/motion/clock',
  'review -> figure/motion/compose',
  'review -> figure/motion/library',
  'review -> figure/motion/MotionStage',
])

describe('feature boundaries', () => {
  it('features use each other only through an index or shared', () => {
    const edges = new Set<string>()
    crossImports((from, to, rest) => {
      if (to !== 'shared' && rest !== '' && rest !== 'index') edges.add(`${from} -> ${to}/${rest.replace(/\.tsx?$/, '')}`)
      return false
    })
    expect([...edges].filter((e) => !KNOWN.has(e)).sort()).toEqual([])
  })

  it('shared imports no feature', () => {
    expect(crossImports((from) => from === 'shared')).toEqual([])
  })

  it('code outside features and routes imports no feature', () => {
    const src = path.dirname(FEATURES)
    const outside = ['app', 'data', 'domain', 'i18n', 'store', 'sw', 'ui'].flatMap((dir) => modules(path.join(src, dir)))
    const reaches = outside.flatMap((file) =>
      specifiers(file)
        .filter((s) => s.startsWith('.') && path.resolve(path.dirname(file), s).startsWith(FEATURES + path.sep))
        .map((s) => `${path.relative(src, file)} -> ${s}`),
    )
    expect(reaches).toEqual([])
  })
})
