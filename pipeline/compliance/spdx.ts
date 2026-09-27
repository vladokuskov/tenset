// Minimal SPDX expression check: OR needs one allowed branch, AND needs all, "X WITH exception" counts as X.

const ALIASES: Record<string, string> = {
  'Apache 2.0': 'Apache-2.0',
  'Apache License 2.0': 'Apache-2.0',
  'CC0': 'CC0-1.0',
  'OFL': 'OFL-1.1',
}

export function normalizeLicense(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map(normalizeLicense).join(' OR ')
  if (raw && typeof raw === 'object' && 'type' in raw) return normalizeLicense((raw as { type: unknown }).type)
  if (typeof raw !== 'string' || !raw.trim()) return 'UNKNOWN'
  const s = raw.trim()
  return ALIASES[s] ?? s
}

export function spdxAllowed(expr: string, allowed: ReadonlySet<string>): boolean {
  const tokens = expr.replace(/[()]/g, ' $& ').trim().split(/\s+/)
  let i = 0
  const orExpr = (): boolean => {
    let ok = andExpr()
    while (tokens[i] === 'OR') {
      i++
      ok = andExpr() || ok
    }
    return ok
  }
  const andExpr = (): boolean => {
    let ok = atom()
    while (tokens[i] === 'AND') {
      i++
      ok = atom() && ok
    }
    return ok
  }
  const atom = (): boolean => {
    const t = tokens[i++]
    if (t === '(') {
      const ok = orExpr()
      if (tokens[i++] !== ')') throw new Error(`unbalanced license expression: ${expr}`)
      return ok
    }
    if (!t || t === ')' || t === 'AND' || t === 'OR' || t === 'WITH') throw new Error(`bad license expression: ${expr}`)
    if (tokens[i] === 'WITH') i += 2
    return allowed.has(t.replace(/\+$/, ''))
  }
  const ok = orExpr()
  if (i !== tokens.length) throw new Error(`bad license expression: ${expr}`)
  return ok
}
