import { dayName, type DayIndex } from '../../app/days'
import { formatSets } from '../../app/format'
import type { MainPattern, MissingPatternKind } from '../../domain/coverage'
import { common } from '../../i18n/common'
import { defineMessages } from '../../i18n/messages'
import { plural } from '../../i18n/plural'

type Missing = { label: string; examples: string; why: string }

/** "3" or "3-4": the spread of rest days between sessions. */
const gapRange = (gaps: readonly number[]) => {
  const lo = Math.min(...gaps)
  const hi = Math.max(...gaps)
  return lo === hi ? String(lo) : `${lo}-${hi}`
}

// Groups whose parts Ukrainian calls «пучки»; the rest use «частини».
const BUNDLES = new Set(['biceps', 'triceps', 'front_delt', 'side_delt', 'rear_delt'])

export const bodymapMessages = defineMessages({
  en: {
    missingPattern: {
      horizontal_pull: { label: 'Horizontal pull', examples: 'rows', why: 'No exercise in this program is a row.' },
      vertical_pull: {
        label: 'Vertical pull',
        examples: 'pull-ups, pulldowns',
        why: 'No exercise in this program pulls from overhead.',
      },
      knee_flexion: { label: 'Knee flexion', examples: 'leg curls', why: 'No exercise in this program bends the knee against load.' },
      hip_hinge: { label: 'Hip hinge', examples: 'deadlifts, RDLs', why: 'No exercise in this program is a hip hinge.' },
      direct_rear_delt: {
        label: 'Direct rear delt work',
        examples: 'rear delt flys, face pulls',
        why: 'No exercise in this program has rear delts as a primary muscle.',
      },
    } satisfies Record<MissingPatternKind, Missing>,
    mainPattern: {
      squat: 'Squat',
      hinge: 'Hinge',
      horizontal_push: 'Horizontal push',
      vertical_push: 'Vertical push',
      horizontal_pull: 'Horizontal pull',
      vertical_pull: 'Vertical pull',
    } satisfies Record<MainPattern, string>,
    legend: { none: 'None', light: 'Light', moderate: 'Moderate', target: 'Target', high: 'High', very_high: 'Very high' } as Record<
      string,
      string
    >,

    // schedule
    notTrainedThisWeek: 'Not trained this week',
    noDayReaches: (n: number) => `No day reaches ${n} sets`,
    trainedOnce: (days: string) => `Trained ${days} · once a week`,
    trainedGaps: (days: string, gaps: readonly number[]) => `Trained ${days} · ${gapRange(gaps)} days apart`,

    // sources
    heuristic: 'A rule of thumb built into this app, not a study result.',
    expertOpinion: 'Expert opinion',

    // why
    whyLabel: (topic: string) => `Why? ${topic}`,
    why: 'why?',

    // body map
    bodyMap: 'Body map',
    front: 'Front',
    back: 'Back',
    zoomedView: 'Zoomed view',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    whichMuscle: 'Which muscle?',

    // legend
    weekCaption: (lo: number, hi: number) =>
      `Sets per muscle each week. Most muscles aim for ${formatSets(lo, 'en')} to ${formatSets(hi, 'en')}.`,
    dayCaption: 'Sets per muscle in this session.',
    colorScale: (week: boolean) => `Color scale, ${week ? 'week' : 'day'}`,

    // day strip
    setsPerDay: (summary: string) => `Sets per day: ${summary}`,

    // coverage
    setsOnDay: (sets: number, day: DayIndex) => `${formatSets(sets, 'en')} on ${dayName(day, 'short', 'en')}`,
    noBand: 'no target',
    noRangeSet: 'no range set',
    optional: 'optional',
    coverage: 'Coverage',
    groupsTrained: (trained: number, total: number) => `${trained} of ${total} groups trained this week`,
    howBandsWork: 'How bands work',
    bandsBody:
      'Each set counts 1.0 for a primary muscle and 0.5 for a secondary one. Weekly totals fall into bands; most groups sit in the target range at 10 to 20 sets. Optional groups use their own range and read "some sets" instead of light below it.',
    notTrained: 'Not trained:',
    optionalNotTrained: 'Optional, not trained',
    alsoTracked: 'Also tracked',

    // insights
    balance: 'Balance',
    balanceDescription: 'Side-by-side counts, not rules.',
    pushPullTitle: 'Push and pull, working sets',
    push: 'push',
    pull: 'pull',
    pushPullTopic: 'Push and pull',
    pushPullBody:
      'Working sets of pressing (flat, incline, overhead, dips) next to pulling (rows, pull-ups, pulldowns). There is no target ratio here, only the two counts.',
    thighTitle: 'Front and back of the thigh, weekly sets',
    quads: 'quads',
    hamstrings: 'hamstrings',
    thighTopic: 'Quads and hamstrings',
    thighBody: 'Weekly fractional sets for each group, shown side by side.',
    strengthGoal: 'Strength goal',
    strengthDays: (pattern: string, days: number) => `${pattern} on ${days} ${days === 1 ? 'day' : 'days'} a week`,
    frequencyTopic: (pattern: string) => `${pattern} frequency`,
    frequencyBody:
      'With a strength goal, each main pattern shows how many days it is trained. Two or more days is the usual reference point.',
    notInWeek: 'Not in this week',
    checklist: 'The checklist is a quick way to spot a movement the week leaves out.',

    // muscle sheet
    muscle: 'Muscle',
    optionalGroup: 'Optional group',
    weeklySets: (n: number) => `weekly ${plural('en', n, { one: 'set', other: 'sets' })}`,
    bandTopic: (group: string) => `${group} band`,
    targetRange: (lo: number, hi: number) =>
      `${formatSets(lo, 'en')} to ${formatSets(hi, 'en')} weekly sets, this group's target range.`,
    noBandNote: 'Tracked for reference, with no target range.',
    skippedNote: 'No range set for this muscle.',
    changeRange: 'Change range',
    days: 'Days',
    heads: (_group: string) => 'Parts',
    lighterEmphasis: (pct: number) => `Less direct work, ${pct}% of the group's sets`,
    emphasisTopic: (head: string) => `${head} emphasis`,
    emphasisBody:
      "Heads shade by how much each exercise emphasizes them. This one gets less than 60% of the group's weekly sets, so it has less direct work than the rest of the group.",
    includes: 'includes: ',
    howSetsCount: 'How sets count',
    contribution: (sets: number, value: number) =>
      sets === value ? common.en.sets(sets) : `${common.en.sets(sets)}, counts as ${formatSets(value, 'en')}`,
    howSetsCountBody: 'A set counts 1.0 toward a primary muscle and 0.5 toward a secondary one. The map adds these up per group.',
    fromYourExercises: 'From your exercises',
    unknownExercise: 'Unknown exercise',
    total: 'Total',
    mostEmphasis: (head: string) => `Most emphasis on ${head.toLowerCase()}`,
    ideas: 'Ideas for this muscle',
    usingEquipment: 'Using the equipment in your settings.',
    rest: 'Rest',
    addToWhichDay: 'Add to which day?',
    addForMuscle: 'Add exercise for this muscle',
    addOnDay: (day: DayIndex) => `Add exercise on ${dayName(day, 'long', 'en')}`,
  },
  uk: {
    missingPattern: {
      horizontal_pull: {
        label: 'Горизонтальна тяга',
        examples: 'тяги до пояса',
        why: 'Жодна вправа в цій програмі не є тягою до пояса.',
      },
      vertical_pull: {
        label: 'Вертикальна тяга',
        examples: 'підтягування, тяги верхнього блока',
        why: 'Жодна вправа в цій програмі не тягне згори.',
      },
      knee_flexion: {
        label: 'Згинання коліна',
        examples: 'згинання ніг',
        why: 'Жодна вправа в цій програмі не згинає коліно з навантаженням.',
      },
      hip_hinge: {
        label: 'Нахил від таза',
        examples: 'станові тяги, румунські тяги',
        why: 'Жодна вправа в цій програмі не є нахилом від таза.',
      },
      direct_rear_delt: {
        label: 'Пряма робота на задні дельти',
        examples: 'розведення на задні дельти, тяга каната до обличчя',
        why: 'У жодній вправі цієї програми задні дельти не є основним мʼязом.',
      },
    },
    mainPattern: {
      squat: 'Присідання',
      hinge: 'Нахил від таза',
      horizontal_push: 'Горизонтальний жим',
      vertical_push: 'Вертикальний жим',
      horizontal_pull: 'Горизонтальна тяга',
      vertical_pull: 'Вертикальна тяга',
    },
    legend: { none: 'Немає', light: 'Мало', moderate: 'Помірно', target: 'Ціль', high: 'Багато', very_high: 'Дуже багато' },

    notTrainedThisWeek: 'Цього тижня не тренується',
    noDayReaches: (n) => `Жодного дня не набирається ${common.uk.sets(n)}`,
    trainedOnce: (days) => `Тренується: ${days} · раз на тиждень`,
    trainedGaps: (days, gaps) => `Тренується: ${days} · перерви ${gapRange(gaps)} дн.`,

    heuristic: 'Емпіричне правило, закладене в застосунок, а не результат дослідження.',
    expertOpinion: 'Думка експертів',

    whyLabel: (topic) => `Чому? ${topic}`,
    why: 'чому?',

    bodyMap: 'Мапа тіла',
    front: 'Спереду',
    back: 'Ззаду',
    zoomedView: 'Збільшений вигляд',
    zoomIn: 'Збільшити',
    zoomOut: 'Зменшити',
    whichMuscle: 'Який мʼяз?',

    weekCaption: (lo, hi) =>
      `Підходи на мʼяз за тиждень. Ціль для більшості мʼязів: від ${formatSets(lo, 'uk')} до ${formatSets(hi, 'uk')}.`,
    dayCaption: 'Підходи на мʼяз за це тренування.',
    colorScale: (week) => `Шкала кольору, ${week ? 'тиждень' : 'день'}`,

    setsPerDay: (summary) => `Підходи за днями: ${summary}`,

    setsOnDay: (sets, day) => `${dayName(day, 'short', 'uk')}: ${formatSets(sets, 'uk')}`,
    noBand: 'без цілі',
    noRangeSet: 'діапазон не задано',
    optional: 'необовʼязкова',
    coverage: 'Охоплення',
    groupsTrained: (trained, total) => `Цього тижня тренується ${trained} з ${total} груп`,
    howBandsWork: 'Як працюють діапазони',
    bandsBody:
      'Кожен підхід рахується як 1,0 для основного мʼяза і 0,5 для допоміжного. Тижневі суми потрапляють у діапазони; для більшості груп цільовий діапазон становить від 10 до 20 підходів. Необовʼязкові групи мають власний діапазон і нижче нього показують «кілька підходів» замість «мало».',
    notTrained: 'Не тренуються:',
    optionalNotTrained: 'Необовʼязкові, не тренуються',
    alsoTracked: 'Також відстежуються',

    balance: 'Баланс',
    balanceDescription: 'Порівняння чисел, а не правила.',
    pushPullTitle: 'Жим і тяга, робочі підходи',
    push: 'жим',
    pull: 'тяга',
    pushPullTopic: 'Жим і тяга',
    pushPullBody:
      'Робочі підходи жимів (горизонтальних, під кутом, над головою, на брусах) поруч із тягами (до пояса, підтягування, верхнього блока). Цільового співвідношення тут немає, лише два числа.',
    thighTitle: 'Передня і задня поверхня стегна, тижневі підходи',
    quads: 'квадрицепси',
    hamstrings: 'задня поверхня',
    thighTopic: 'Квадрицепси і задня поверхня стегна',
    thighBody: 'Тижневі дробові підходи для кожної групи, поруч.',
    strengthGoal: 'Ціль: сила',
    strengthDays: (pattern, days) => `${pattern}: ${common.uk.days(days)} на тиждень`,
    frequencyTopic: (pattern) => `${pattern}: частота`,
    frequencyBody:
      'З ціллю «сила» для кожного основного руху показано, скільки днів на тиждень він тренується. Звичний орієнтир: два дні або більше.',
    notInWeek: 'Немає цього тижня',
    checklist: 'Цей список допомагає швидко помітити рух, якого немає в тижні.',

    muscle: 'Мʼяз',
    optionalGroup: 'Необовʼязкова група',
    weeklySets: (n) => `${plural('uk', n, { one: 'підхід', few: 'підходи', many: 'підходів', other: 'підходу' })} на тиждень`,
    bandTopic: (group) => `Діапазон: ${group}`,
    targetRange: (lo, hi) =>
      `Від ${formatSets(lo, 'uk')} до ${formatSets(hi, 'uk')} підходів на тиждень, цільовий діапазон цієї групи.`,
    noBandNote: 'Відстежується для довідки, без цільового діапазону.',
    skippedNote: 'Для цього мʼяза діапазон не задано.',
    changeRange: 'Змінити діапазон',
    days: 'Дні',
    heads: (group) => (BUNDLES.has(group) ? 'Пучки' : 'Частини'),
    lighterEmphasis: (pct) => `Менший акцент, ${pct}% підходів групи`,
    emphasisTopic: (head) => `Акцент: ${head}`,
    emphasisBody:
      'Зафарбовування показує, наскільки кожна вправа акцентує на цій частині мʼяза. Сюди припадає менше 60% тижневих підходів групи, тож прямої роботи тут менше, ніж на решту групи.',
    includes: 'включає: ',
    howSetsCount: 'Як рахуються підходи',
    contribution: (sets, value) =>
      sets === value ? common.uk.sets(sets) : `${common.uk.sets(sets)}, рахується як ${formatSets(value, 'uk')}`,
    howSetsCountBody: 'Підхід рахується як 1,0 для основного мʼяза і 0,5 для допоміжного. Мапа підсумовує це для кожної групи.',
    fromYourExercises: 'З ваших вправ',
    unknownExercise: 'Невідома вправа',
    total: 'Разом',
    mostEmphasis: (head) => `Найбільший акцент: ${head}`,
    ideas: 'Ідеї для цього мʼяза',
    usingEquipment: 'З обладнанням із ваших налаштувань.',
    rest: 'Відпочинок',
    addToWhichDay: 'На який день додати?',
    addForMuscle: 'Додати вправу на цей мʼяз',
    addOnDay: (day) => `Додати вправу ${dayName(day, 'to', 'uk')}`,
  },
})
