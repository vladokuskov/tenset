import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = import.meta.dirname
// imported only by tests
const TEST_SUPPORT = ['motion/testing.ts']

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return modules(p)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}

describe('src stays browser-only', () => {
  it('no app module imports a Node builtin', () => {
    const offenders = modules(SRC)
      .filter((f) => /from ['"]node:|import\(['"]node:/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    expect(offenders.filter((f) => !TEST_SUPPORT.includes(f))).toEqual([])
  })
})
