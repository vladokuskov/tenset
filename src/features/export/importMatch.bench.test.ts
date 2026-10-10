import { describe, expect, it } from 'vitest'
import { activeExercises } from '../../data/catalog'
import { localizeExercise } from '../../data/localize'
import type { Locale } from '../../i18n/locale'
import { createMatcher } from './importMatch'

/**
 * Names as people write them in notes, with the slugs that count as a right answer.
 * Lines keep their sets and weights on purpose: the matcher gets parser output in the app,
 * but pasted names are not always clean.
 */
const CASES: readonly (readonly [string, string | readonly string[]])[] = [
  // English, plain
  ['Bench press', 'barbell-bench-press'],
  ['Incline DB press', 'incline-dumbbell-press'],
  ['incline dumbbell bench', 'incline-dumbbell-press'],
  ['Flat dumbbell press', 'dumbbell-bench-press'],
  ['OHP', 'barbell-overhead-press'],
  ['Military press', 'barbell-overhead-press'],
  ['Lateral raises', ['dumbbell-lateral-raise', 'cable-lateral-raise']],
  ['Side raises', 'dumbbell-lateral-raise'],
  ['Cable lateral raise', 'cable-lateral-raise'],
  ['Rear delt fly', 'bent-over-rear-delt-fly'],
  ['Face pulls', 'face-pull'],
  ['Pull ups', 'pull-up'],
  ['Pullups', 'pull-up'],
  ['Chin ups', 'chin-up'],
  ['Lat pulldown', 'lat-pulldown'],
  ['Lat pull down', 'lat-pulldown'],
  ['Close grip pulldown', 'close-grip-pulldown'],
  ['Barbell row', 'barbell-row'],
  ['Bent over row', 'barbell-row'],
  ['Seated cable row', 'seated-cable-row'],
  ['Cable rows', 'seated-cable-row'],
  ['One arm dumbbell row', 'one-arm-dumbbell-row'],
  ['DB row', 'one-arm-dumbbell-row'],
  ['T-bar row', 't-bar-row'],
  ['Tbar row', 't-bar-row'],
  ['Shrugs', ['dumbbell-shrug', 'barbell-shrug', 'trap-bar-shrug']],
  ['Squats', 'barbell-back-squat'],
  ['Back squat', 'barbell-back-squat'],
  ['Front squats', 'barbell-front-squat'],
  ['Leg press', 'leg-press'],
  ['Bulgarian split squats', 'bulgarian-split-squat'],
  ['BSS', 'bulgarian-split-squat'],
  ['Leg extensions', 'leg-extension'],
  ['Leg curls', ['lying-leg-curl', 'seated-leg-curl']],
  ['Seated leg curl', 'seated-leg-curl'],
  ['Lying hamstring curl', 'lying-leg-curl'],
  ['RDL', 'barbell-romanian-deadlift'],
  ['Romanian deadlifts', 'barbell-romanian-deadlift'],
  ['DB RDL', 'dumbbell-romanian-deadlift'],
  ['Deadlift', 'conventional-deadlift'],
  ['Deadlifts', 'conventional-deadlift'],
  ['Sumo deadlift', 'sumo-deadlift'],
  ['Hip thrusts', 'barbell-hip-thrust'],
  ['Glute bridge', 'glute-bridge'],
  ['Walking lunges', 'dumbbell-walking-lunge'],
  ['Reverse lunges', 'dumbbell-reverse-lunge'],
  ['Goblet squat', 'goblet-squat'],
  ['Hack squat', 'hack-squat'],
  ['Calf raises', 'standing-calf-raise'],
  ['Seated calf raise', 'seated-calf-raise'],
  ['Hyperextensions', 'back-extension'],
  ['Barbell curl', 'barbell-curl'],
  ['EZ bar curl', 'ez-bar-curl'],
  ['Hammer curls', 'hammer-curl'],
  ['Incline curls', 'incline-dumbbell-curl'],
  ['Preacher curl', 'ez-bar-preacher-curl'],
  ['Tricep pushdown', ['straight-bar-pushdown', 'rope-pushdown']],
  ['Rope pushdown', 'rope-pushdown'],
  ['Skull crushers', 'ez-bar-skull-crusher'],
  ['Overhead tricep extension', ['overhead-cable-triceps-extension', 'seated-overhead-dumbbell-extension']],
  ['Dips', ['chest-dip', 'upright-triceps-dip']],
  ['Push ups', 'push-up'],
  ['Pec deck', 'pec-deck-fly'],
  ['Cable crossover', 'cable-fly-high-to-low'],
  ['Dumbbell flyes', 'dumbbell-fly'],
  ['Arnold press', 'arnold-press'],
  ['Plank', 'plank'],
  ['Hanging leg raises', 'hanging-leg-raise'],
  ['Cable crunches', 'cable-crunch'],
  ['Ab wheel', ['ab-wheel-rollout', 'kneeling-ab-wheel-rollout']],
  ['Russian twists', 'russian-twist'],
  ['Good mornings', 'good-morning'],
  ['Kettlebell swings', 'kettlebell-swing'],
  ['Pallof press', 'pallof-press'],
  // English, typos and noise
  ['Bench pres', 'barbell-bench-press'],
  ['Romanain deadlift', 'barbell-romanian-deadlift'],
  ['Laterl raise', ['dumbbell-lateral-raise', 'cable-lateral-raise']],
  ['Bench press 80kg 3x8', 'barbell-bench-press'],
  ['Squat 100x5x5', 'barbell-back-squat'],
  ['Incline DB press 3x10 @ 25kg', 'incline-dumbbell-press'],
  // Ukrainian
  ['Жим штанги лежачи', 'barbell-bench-press'],
  ['Жим лежачи', 'barbell-bench-press'],
  ['Жим гантелей лежачи', 'dumbbell-bench-press'],
  ['Жим гантелей на похилій лаві', 'incline-dumbbell-press'],
  ['Жим гантелей під кутом', 'incline-dumbbell-press'],
  ['Жим штанги стоячи', 'barbell-overhead-press'],
  ['Армійський жим', 'barbell-overhead-press'],
  ['Жим гантелей сидячи', 'seated-dumbbell-shoulder-press'],
  ['Махи гантелями в сторони', 'dumbbell-lateral-raise'],
  ['Махи в сторони', ['dumbbell-lateral-raise', 'cable-lateral-raise']],
  ['Підтягування', 'pull-up'],
  ['Підтягування широким хватом', 'wide-grip-pull-up'],
  ['Тяга верхнього блоку', 'lat-pulldown'],
  ['Тяга верхнього блока до грудей', 'lat-pulldown'],
  ['Тяга нижнього блоку', 'seated-cable-row'],
  ['Тяга штанги в нахилі', 'barbell-row'],
  ['Тяга гантелі однією рукою', 'one-arm-dumbbell-row'],
  ['Тяга гантелі в нахилі', 'one-arm-dumbbell-row'],
  ['Шраги', ['dumbbell-shrug', 'barbell-shrug', 'trap-bar-shrug']],
  ['Присідання зі штангою', 'barbell-back-squat'],
  ['Присідання', 'barbell-back-squat'],
  ['Присід', 'barbell-back-squat'],
  ['Жим ногами', 'leg-press'],
  ['Жим ногами в тренажері', 'leg-press'],
  ['Болгарські присідання', 'bulgarian-split-squat'],
  ['Болгарські випади', 'bulgarian-split-squat'],
  ['Розгинання ніг', 'leg-extension'],
  ['Згинання ніг лежачи', 'lying-leg-curl'],
  ['Румунська тяга', 'barbell-romanian-deadlift'],
  ['Станова тяга', 'conventional-deadlift'],
  ['Станова', 'conventional-deadlift'],
  ['Хіп-траст', 'barbell-hip-thrust'],
  ['Сідничний міст', 'glute-bridge'],
  ['Випади', 'dumbbell-walking-lunge'],
  ['Гіперекстензія', 'back-extension'],
  ['Підйом на носки стоячи', 'standing-calf-raise'],
  ['Згинання рук зі штангою', 'barbell-curl'],
  ['Біцепс зі штангою', 'barbell-curl'],
  ['Молотки', 'hammer-curl'],
  ['Французький жим', 'ez-bar-skull-crusher'],
  ['Розгинання на блоці з канатом', 'rope-pushdown'],
  ['Бруси', ['chest-dip', 'upright-triceps-dip']],
  ['Віджимання', 'push-up'],
  ['Віджимання на брусах', ['chest-dip', 'upright-triceps-dip']],
  ['Кросовер', 'cable-fly-high-to-low'],
  ['Розводка гантелей', 'dumbbell-fly'],
  ['Метелик', 'pec-deck-fly'],
  ['Планка', 'plank'],
  ['Скручування', 'crunch'],
  ['Підйом ніг у висі', 'hanging-leg-raise'],
  // Ukrainian, inflected and with numbers
  ['Присідання зі штангою на плечах', 'barbell-back-squat'],
  ['Жим штанги лежачи 4х8 по 60кг', 'barbell-bench-press'],
  ['Тяга верхнього блоку широким хватом', 'lat-pulldown'],
  ['Жим гантелей на похилій', 'incline-dumbbell-press'],
  ['Розведення гантелей в сторони', 'dumbbell-lateral-raise'],
  ['Згинання рук з гантелями', 'dumbbell-curl'],
  // Russian and surzhyk
  ['Жим лежа', 'barbell-bench-press'],
  ['Жим штанги лежа', 'barbell-bench-press'],
  ['Жим гантелей лежа', 'dumbbell-bench-press'],
  ['Жим гантелей на наклонной', 'incline-dumbbell-press'],
  ['Жим стоя', 'barbell-overhead-press'],
  ['Армейский жим', 'barbell-overhead-press'],
  ['Махи гантелями в стороны', 'dumbbell-lateral-raise'],
  ['Подтягивания', 'pull-up'],
  ['Тяга верхнего блока', 'lat-pulldown'],
  ['Тяга нижнего блока', 'seated-cable-row'],
  ['Тяга штанги в наклоне', 'barbell-row'],
  ['Тяга гантели одной рукой', 'one-arm-dumbbell-row'],
  ['Приседания', 'barbell-back-squat'],
  ['Приседания со штангой', 'barbell-back-squat'],
  ['Присед', 'barbell-back-squat'],
  ['Жим ногами', 'leg-press'],
  ['Разгибания ног', 'leg-extension'],
  ['Сгибания ног лежа', 'lying-leg-curl'],
  ['Румынская тяга', 'barbell-romanian-deadlift'],
  ['Становая тяга', 'conventional-deadlift'],
  ['Становая', 'conventional-deadlift'],
  ['Выпады', 'dumbbell-walking-lunge'],
  ['Ягодичный мост', 'glute-bridge'],
  ['Гиперэкстензия', 'back-extension'],
  ['Подъем на носки', 'standing-calf-raise'],
  ['Подъем штанги на бицепс', 'barbell-curl'],
  ['Молотки', 'hammer-curl'],
  ['Французский жим', 'ez-bar-skull-crusher'],
  ['Брусья', ['chest-dip', 'upright-triceps-dip']],
  ['Отжимания', 'push-up'],
  ['Сведения в кроссовере', 'cable-fly-high-to-low'],
  ['Разводка гантелей', 'dumbbell-fly'],
  ['Бабочка', 'pec-deck-fly'],
  ['Скручивания', 'crunch'],
  ['Подъем ног в висе', 'hanging-leg-raise'],
  ['Шраги', ['dumbbell-shrug', 'barbell-shrug', 'trap-bar-shrug']],
  ['Тяга к лицу', 'face-pull'],
]

/** Nothing in the catalog fits these, so the matcher must not claim a sure match. */
const NO_SURE_MATCH = ['Біцепс', 'Ноги', 'Cardio 20 min', 'Zercher carry', 'Farmer walk', 'Turkish get-up', 'Sled push', 'Кардіо']

const slugOf = new Map(activeExercises.map((e) => [e.id, e.slug]))

function run(locale: Locale) {
  const exercises = activeExercises.map((e) => localizeExercise(e, locale))
  const matcher = createMatcher(exercises, [], locale)
  const misses: string[] = []
  const wrongSure: string[] = []
  let hit = 0
  for (const [query, want] of CASES) {
    const ok = typeof want === 'string' ? [want] : want
    const r = matcher.match(query)
    const got = r.best ? slugOf.get(r.best.ref as number) : undefined
    if (got && ok.includes(got)) hit++
    else {
      misses.push(`${query} -> ${got ?? 'none'} (${r.confidence})`)
      if (r.confidence === 'exact' || r.confidence === 'good') wrongSure.push(`${query} -> ${got} (${r.confidence})`)
    }
  }
  const sureNonsense = NO_SURE_MATCH.map((q) => [q, matcher.match(q).confidence] as const).filter(([, c]) => c === 'exact' || c === 'good')
  return { accuracy: hit / CASES.length, misses, wrongSure, sureNonsense }
}

describe.each(['en', 'uk'] as const)('matcher benchmark, %s UI', (locale) => {
  const r = run(locale)

  it('finds the right exercise for at least 95% of note names', () => {
    console.info(`[${locale}] ${(r.accuracy * 100).toFixed(1)}% top-1 of ${CASES.length}${r.misses.length ? `, misses:\n  ${r.misses.join('\n  ')}` : ''}`)
    expect(r.accuracy).toBeGreaterThanOrEqual(0.95)
  })

  it('is never sure about a wrong exercise', () => {
    expect(r.wrongSure).toEqual([])
    expect(r.sureNonsense).toEqual([])
  })
})
