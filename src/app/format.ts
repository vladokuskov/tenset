const oneDecimal = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
const fixedOne = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Fractional set counts: 8 -> "8", 7.5 -> "7.5", 2.25 -> "2.3". */
export function formatSets(value: number): string {
  const v = Math.round(value * 10) / 10
  return oneDecimal.format(v === 0 ? 0 : v)
}

export function plural(n: number, one: string, other = `${one}s`): string {
  return n === 1 ? one : other
}

/** "1 set", "7.5 sets". */
export function setsLabel(value: number): string {
  return `${formatSets(value)} ${plural(value, 'set')}`
}

/** "1 exercise", "5 exercises". */
export function countLabel(n: number, one: string, other?: string): string {
  return `${n} ${plural(n, one, other)}`
}

/** Role weights always show one decimal so the math reads evenly: "1.0", "0.5". */
export function formatWeight(weight: number): string {
  return fixedOne.format(weight)
}

/** Contribution math: "3 × 1.0 = 3". */
export function formatMath(sets: number, weight: number, value = sets * weight): string {
  return `${sets} × ${formatWeight(weight)} = ${formatSets(value)}`
}

/** Before and after a change: "8 → 11". */
export function formatDelta(from: number, to: number): string {
  return `${formatSets(from)} → ${formatSets(to)}`
}

/** Joins short facts with a middle dot, skipping empty parts: "5 exercises · 17 sets". */
export function joinMeta(parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ')
}

export function formatDaySummary(exercises: number, hardSets: number): string {
  if (exercises === 0) return 'No exercises yet'
  return joinMeta([countLabel(exercises, 'exercise'), setsLabel(hardSets)])
}
