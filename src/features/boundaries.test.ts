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

describe('feature boundaries', () => {
  it('other features use builder only through its index', () => {
    expect(crossImports((_, to, rest) => to === 'builder' && rest !== '' && rest !== 'index')).toEqual([])
  })

  it('shared imports no feature', () => {
    expect(crossImports((from) => from === 'shared')).toEqual([])
  })
})
