/**
 * Program notes written the way people keep them, for the paste corpus test. Written for this
 * project; no third-party plans. Each line expects "name | sets x reps | rest N | rir N | ss",
 * leaving out what the line does not give, and "check" when its numbers can be read more than one way.
 * skippedWeeks counts the later weeks that are left out.
 */
export type CorpusDay = { day: number; label?: string; rest?: true; lines?: string[] }
export type CorpusCase = { id: string; text: string; days: CorpusDay[]; unreadable?: number; skippedWeeks?: number }

export const CORPUS: readonly CorpusCase[] = [
  {
    id: 'en-weekdays-plain',
    text: 'Monday\nBench press 3x8\nRow 3x10\n\nWednesday\nSquat 5x5\nRDL 3x8\n\nFriday\nOHP 3x8\nPull-ups 3x8',
    days: [
      { day: 0, lines: ['Bench press | 3x8', 'Row | 3x10'] },
      { day: 2, lines: ['Squat | 5x5', 'RDL | 3x8'] },
      { day: 4, lines: ['OHP | 3x8', 'Pull-ups | 3x8'] },
    ],
  },
  {
    id: 'en-ppl-colon-headers',
    text: 'Push:\n- Bench 4x6-8\n- Incline DB press 3x10\n- Lateral raise 3x15\n\nPull:\n- Pulldown 3x10\n- Cable row 3x12\n\nLegs:\n- Squat 4x6\n- Leg curl 3x12',
    days: [
      { day: 0, label: 'Push', lines: ['Bench | 4x6-8', 'Incline DB press | 3x10', 'Lateral raise | 3x15'] },
      { day: 2, label: 'Pull', lines: ['Pulldown | 3x10', 'Cable row | 3x12'] },
      { day: 4, label: 'Legs', lines: ['Squat | 4x6', 'Leg curl | 3x12'] },
    ],
  },
  {
    id: 'en-session-words-no-colon',
    text: 'Upper\nBench 3x8\nRow 3x8\n\nLower\nSquat 3x6\nLeg curl 3x10',
    days: [
      { day: 0, label: 'Upper', lines: ['Bench | 3x8', 'Row | 3x8'] },
      { day: 3, label: 'Lower', lines: ['Squat | 3x6', 'Leg curl | 3x10'] },
    ],
  },
  {
    id: 'en-emoji-headers-and-checkboxes',
    text: '🔥 Push day 🔥\n✅ Bench 3x8\n☐ Dips 3x10\n\n💪 Pull day\n- [ ] Pull ups 3xAMRAP\n- [x] Face pulls 3x15',
    days: [
      { day: 0, label: 'Push day', lines: ['Bench | 3x8', 'Dips | 3x10'] },
      { day: 3, label: 'Pull day', lines: ['Pull ups | 3x- | rir 0', 'Face pulls | 3x15'] },
    ],
  },
  {
    id: 'en-markdown',
    text: '# Week 1\n## Day 1 - Upper\n1. Bench press 3 sets of 8 reps, 2 min rest\n2. Barbell row 3x8 @ RPE 8\n\n## Day 2 - Lower\n1. Squat 3x5 rest 3 min\n2. RDL 3x10 RIR 2',
    days: [
      { day: 0, label: 'Upper', lines: ['Bench press | 3x8 | rest 120', 'Barbell row | 3x8 | rir 2'] },
      { day: 3, label: 'Lower', lines: ['Squat | 3x5 | rest 180', 'RDL | 3x10 | rir 2'] },
    ],
  },
  {
    id: 'en-workout-log-with-weights',
    text: 'Mon 12.10\nBench 60x10, 70x8, 80x6\nSquat 100x5x5\nOHP 40kg 3x8\nCurl 3x12 @ 15kg',
    days: [{ day: 0, lines: ['Bench | 3x6-10', 'Squat | 5x5', 'OHP | 3x8', 'Curl | 3x12'] }],
  },
  {
    id: 'en-reps-first-and-swapped',
    text: 'Push\n12x3 lateral raises\n10 reps x 3 sets cable fly\nTriceps pushdown 15x2',
    days: [{ day: 0, label: 'Push', lines: ['lateral raises | 3x12', 'cable fly | 3x10', 'Triceps pushdown | 2x15'] }],
  },
  {
    id: 'en-pyramids-and-schemes',
    text: 'Bench 10/8/6\nDeadlift 5/3/1\nRow 4x12,10,8,6\nSquat 12-10-8',
    days: [{ day: 0, lines: ['Bench | 3x6-10', 'Deadlift | 3x1-5', 'Row | 4x6-12', 'Squat | 3x8-12'] }],
  },
  {
    id: 'en-timed-holds',
    text: 'Core\nPlank 3x60s\nSide plank 3 x 30 sec\nHollow hold 45s\nDead hang 1:00',
    days: [{ day: 0, label: 'Core', lines: ['Plank | 3x60s', 'Side plank | 3x30s', 'Hollow hold | -x45s', 'Dead hang | -x60s'] }],
  },
  {
    id: 'en-supersets-a1-a2',
    text: 'Arms\nA1. Barbell curl 3x10\nA2. Skull crusher 3x10\nB1. Hammer curl 3x12\nB2. Pushdown 3x12\nC1. Wrist curl 2x15',
    days: [
      {
        day: 0,
        label: 'Arms',
        lines: ['Barbell curl | 3x10', 'Skull crusher | 3x10 | ss', 'Hammer curl | 3x12', 'Pushdown | 3x12 | ss', 'Wrist curl | 2x15'],
      },
    ],
  },
  {
    id: 'en-supersets-plus-and-ss',
    text: 'Curl + Pushdown 3x12\nSS: Lateral raise 3x15\nSS: Rear delt fly 3x15\nFace pull 3x20',
    days: [
      {
        day: 0,
        lines: ['Curl | 3x12', 'Pushdown | 3x12 | ss', 'Lateral raise | 3x15', 'Rear delt fly | 3x15 | ss', 'Face pull | 3x20'],
      },
    ],
  },
  {
    id: 'en-comments-and-sides',
    text: 'Legs\nSquat 3x5 heavy\nBulgarian split squat 3x10 each leg\nLeg press 4x12 (feet high)\nHack squat 3x8 - slow negatives\nCalf raise 4x15 tempo 3-1-1-0',
    days: [
      {
        day: 0,
        label: 'Legs',
        lines: ['Squat | 3x5', 'Bulgarian split squat | 3x10', 'Leg press | 4x12', 'Hack squat | 3x8', 'Calf raise | 4x15'],
      },
    ],
  },
  {
    id: 'en-trailing-modifier-stays',
    text: 'Pulldown 3x10 wide grip\nBench 3x8 close grip',
    days: [{ day: 0, lines: ['Pulldown wide grip | 3x10', 'Bench close grip | 3x8'] }],
  },
  {
    id: 'en-rest-after-and-failure',
    text: 'Dips 3 x failure\nPush-ups 2 sets to failure\nRow 3x10, 90s rest\nPull-ups 3x max, rest 2-3 min',
    days: [{ day: 0, lines: ['Dips | 3x- | rir 0', 'Push-ups | 2x- | rir 0', 'Row | 3x10 | rest 90', 'Pull-ups | 3x- | rest 120 | rir 0'] }],
  },
  {
    id: 'en-rest-days-in-order',
    text: 'Day 1: Upper\nBench 3x8\nDay 2: Lower\nSquat 3x8\nDay 3: Rest\nDay 4: Upper\nOHP 3x8\nDay 5: Lower\nDeadlift 3x5',
    days: [
      { day: 0, label: 'Upper', lines: ['Bench | 3x8'] },
      { day: 1, label: 'Lower', lines: ['Squat | 3x8'] },
      { day: 2, rest: true },
      { day: 3, label: 'Upper', lines: ['OHP | 3x8'] },
      { day: 4, label: 'Lower', lines: ['Deadlift | 3x5'] },
    ],
  },
  {
    id: 'en-shared-weekdays',
    text: 'Mon/Thu: Upper\nBench 3x8\nRow 3x8\n\nTue & Fri - Lower\nSquat 3x6',
    days: [
      { day: 0, label: 'Upper', lines: ['Bench | 3x8', 'Row | 3x8'] },
      { day: 1, label: 'Lower', lines: ['Squat | 3x6'] },
      { day: 3, label: 'Upper', lines: ['Bench | 3x8', 'Row | 3x8'] },
      { day: 4, label: 'Lower', lines: ['Squat | 3x6'] },
    ],
  },
  {
    id: 'en-spreadsheet-tabs-no-header',
    text: 'Bench press\t3\t8-10\nIncline press\t3\t10\nFly\t2\t15',
    days: [{ day: 0, lines: ['Bench press | 3x8-10', 'Incline press | 3x10', 'Fly | 2x15'] }],
  },
  {
    id: 'en-csv-scheme-column',
    text: 'Day,Exercise,Sets x Reps\nMon,Bench,\nMon,Row,\n',
    days: [{ day: 0, lines: ['Bench', 'Row'] }],
  },
  {
    id: 'en-csv-reps-column-has-scheme',
    text: 'Day;Exercise;Reps\nMon;Bench;3x8\nWed;Squat;5x5',
    days: [
      { day: 0, lines: ['Bench | 3x8'] },
      { day: 2, lines: ['Squat | 5x5'] },
    ],
  },
  {
    id: 'en-noise-and-unicode',
    text: 'Week 3\n \nMonday — Push\nＢench ３x８\n12/10/2026\n---\nDips 3×10',
    days: [{ day: 0, label: 'Push', lines: ['Bench | 3x8', 'Dips | 3x10'] }],
  },
  {
    id: 'en-crlf-and-smart-quotes',
    text: 'Friday\r\nPlank 3x45”\r\nRow 3x10 rest 2’\r\n',
    days: [{ day: 4, lines: ['Plank | 3x45s', 'Row | 3x10 | rest 120'] }],
  },
  {
    id: 'en-on-weekday-and-rest-word',
    text: 'On Monday\nSquat 3x5\nSunday: off',
    days: [
      { day: 0, lines: ['Squat | 3x5'] },
      { day: 6, rest: true },
    ],
  },
  {
    id: 'en-garbage-lines-warn',
    text: 'Squat 3x5\n4x4\n???\nBench 3x5',
    days: [{ day: 0, lines: ['Squat | 3x5', 'Bench | 3x5'] }],
    unreadable: 1,
  },
  {
    id: 'en-bare-list-no-numbers',
    text: 'Squat\nBench press\nPull-ups\nPlank',
    days: [{ day: 0, lines: ['Squat', 'Bench press', 'Pull-ups', 'Plank'] }],
  },
  {
    id: 'en-four-sessions-spread',
    text: 'Upper A\nBench 3x8\n\nLower A\nSquat 3x8\n\nUpper B\nOHP 3x8\n\nLower B\nDeadlift 3x5',
    days: [
      { day: 0, label: 'Upper A', lines: ['Bench | 3x8'] },
      { day: 1, label: 'Lower A', lines: ['Squat | 3x8'] },
      { day: 3, label: 'Upper B', lines: ['OHP | 3x8'] },
      { day: 4, label: 'Lower B', lines: ['Deadlift | 3x5'] },
    ],
  },
  // Ukrainian
  {
    id: 'uk-weekdays-dash-labels',
    text: 'Понеділок — груди/трицепс\n1) Жим лежачи 4х8\n2) Жим гантелей на похилій 3х10\n3) Французький жим 3х12\n\nВівторок: відпочинок\n\nСереда - спина\nПідтягування 3х макс\nТяга штанги в нахилі 4х8',
    days: [
      { day: 0, label: 'груди/трицепс', lines: ['Жим лежачи | 4x8', 'Жим гантелей на похилій | 3x10', 'Французький жим | 3x12'] },
      { day: 1, rest: true },
      { day: 2, label: 'спина', lines: ['Підтягування | 3x- | rir 0', 'Тяга штанги в нахилі | 4x8'] },
    ],
  },
  {
    id: 'uk-po-and-words',
    text: 'Ноги\nПрисідання 4 по 8-10\nЖим ногами 3 підходи по 12 повторень, відпочинок 90с\nВипади 3х12 на кожну ногу\nЗгинання ніг 3 рази по 15',
    days: [
      {
        day: 0,
        label: 'Ноги',
        lines: ['Присідання | 4x8-10', 'Жим ногами | 3x12 | rest 90', 'Випади | 3x12', 'Згинання ніг | 3x15'],
      },
    ],
  },
  {
    id: 'uk-weights-and-reserve',
    text: 'Пт\nЖим штанги 60кг 4х10\nТяга гантелі по 24 кг 3х10 2 в запасі\nПрисідання 4х6 @8\nПланка 3х60 сек',
    days: [{ day: 4, lines: ['Жим штанги | 4x10', 'Тяга гантелі | 3x10 | rir 2', 'Присідання | 4x6 | rir 2', 'Планка | 3x60s'] }],
  },
  {
    id: 'uk-training-numbers-and-rest-time',
    text: 'Тренування 1\nЖим лежачи 3х8, відпочинок 2 хв\nТяга верхнього блоку 3х10\n\nТренування 2\nСтанова тяга 3х5 до відмови\nГіперекстензія 3х15',
    days: [
      { day: 0, label: 'Тренування 1', lines: ['Жим лежачи | 3x8 | rest 120', 'Тяга верхнього блоку | 3x10'] },
      { day: 3, label: 'Тренування 2', lines: ['Станова тяга | 3x5 | rir 0', 'Гіперекстензія | 3x15'] },
    ],
  },
  {
    id: 'uk-session-labels-and-supersets',
    text: 'Груди + трицепс\nЖим лежачи 4х8\nА1. Розводка гантелей 3х12\nА2. Віджимання 3х макс\n\nСпина + біцепс\nТяга нижнього блоку 3х12\nМолотки + шраги 3х12',
    days: [
      {
        day: 0,
        label: 'Груди + трицепс',
        lines: ['Жим лежачи | 4x8', 'Розводка гантелей | 3x12', 'Віджимання | 3x- | rir 0 | ss'],
      },
      { day: 3, label: 'Спина + біцепс', lines: ['Тяга нижнього блоку | 3x12', 'Молотки | 3x12', 'шраги | 3x12 | ss'] },
    ],
  },
  {
    id: 'uk-date-in-header-and-apostrophes',
    text: "П'ятниця 12 жовтня\nЖим гантелей сидячи 3х12\nП’ятниця\nМахи в сторони 3х15",
    days: [{ day: 4, lines: ['Жим гантелей сидячи | 3x12', 'Махи в сторони | 3x15'] }],
  },
  {
    id: 'uk-in-day-prefix',
    text: 'У вівторок\nЖим лежачи 3х8\nУ четвер\nПрисідання 3х8\nНеділя — вихідний',
    days: [
      { day: 1, lines: ['Жим лежачи | 3x8'] },
      { day: 3, lines: ['Присідання | 3x8'] },
      { day: 6, rest: true },
    ],
  },
  {
    id: 'uk-latin-x-and-star',
    text: 'Біцепс\nЗгинання рук зі штангою 3x10\nМолотки 3*12\nКонцентровані згинання 2 × 15',
    days: [{ day: 0, label: 'Біцепс', lines: ['Згинання рук зі штангою | 3x10', 'Молотки | 3x12', 'Концентровані згинання | 2x15'] }],
  },
  {
    id: 'uk-csv-headers',
    text: 'День;Вправа;Підходи;Повторення;Відпочинок\nПн;Жим лежачи;4;6-8;2:00\nПн;Тяга;3;10;90\nЧт;Присідання;4;8;3 хв',
    days: [
      { day: 0, lines: ['Жим лежачи | 4x6-8 | rest 120', 'Тяга | 3x10 | rest 90'] },
      { day: 3, lines: ['Присідання | 4x8 | rest 180'] },
    ],
  },
  // Russian and surzhyk, read only
  {
    id: 'ru-weekdays-and-po',
    text: 'Понедельник (грудь)\nЖим лежа 3 по 10\nЖим гантелей на наклонной 3х12\nБрусья 3х макс\n\nСреда (ноги)\nПрисед 5х5\nЖим ногами 4х12\n\nПятница - спина\nСтановая тяга 3х5\nПодтягивания 3х макс',
    days: [
      { day: 0, label: 'грудь', lines: ['Жим лежа | 3x10', 'Жим гантелей на наклонной | 3x12', 'Брусья | 3x- | rir 0'] },
      { day: 2, label: 'ноги', lines: ['Присед | 5x5', 'Жим ногами | 4x12'] },
      { day: 4, label: 'спина', lines: ['Становая тяга | 3x5', 'Подтягивания | 3x- | rir 0'] },
    ],
  },
  {
    id: 'ru-words-rest-and-failure',
    text: 'Тренировка А\nПриседания со штангой 4 подхода по 8 повторений, отдых 2 мин\nСгибания ног лежа 3х12 до отказа\nПодъем на носки 4х20, отдых 60 сек',
    days: [
      {
        day: 0,
        label: 'Тренировка А',
        lines: ['Приседания со штангой | 4x8 | rest 120', 'Сгибания ног лежа | 3x12 | rir 0', 'Подъем на носки | 4x20 | rest 60'],
      },
    ],
  },
  {
    id: 'ru-short-weekdays-and-sunday',
    text: 'Вт\nЖим стоя 3х8\nЧт\nТяга верхнего блока 3х10\nВс - отдых',
    days: [
      { day: 1, lines: ['Жим стоя | 3x8'] },
      { day: 3, lines: ['Тяга верхнего блока | 3x10'] },
      { day: 6, rest: true },
    ],
  },
  {
    id: 'ru-with-pause-is-not-seconds',
    text: 'Присед 3х5 с паузой\nЖим лежа 60кг 3х8 с отдыхом 90с',
    days: [{ day: 0, lines: ['Присед с паузой | 3x5', 'Жим лежа | 3x8 | rest 90'] }],
  },
  {
    id: 'mixed-en-uk',
    text: 'Monday - Push\nЖим лежачи 4x8\nLateral raise 3x15\n\nЧетвер - Pull\nPull-ups 3x8\nТяга нижнього блоку 3x12',
    days: [
      { day: 0, label: 'Push', lines: ['Жим лежачи | 4x8', 'Lateral raise | 3x15'] },
      { day: 3, label: 'Pull', lines: ['Pull-ups | 3x8', 'Тяга нижнього блоку | 3x12'] },
    ],
  },
  {
    id: 'telegram-note-to-self',
    text: 'план на тиждень 💪\n\nпн - верх\nжим 4х6-8\nтяга 4х8\nмахи 3х15\n\nср - низ\nприсід 4х6\nрумунка 3х10\n\nпт - фулбаді\nжим стоячи 3х8\nвипади 3х10',
    days: [
      { day: 0, label: 'верх', lines: ['жим | 4x6-8', 'тяга | 4x8', 'махи | 3x15'] },
      { day: 2, label: 'низ', lines: ['присід | 4x6', 'румунка | 3x10'] },
      { day: 4, label: 'фулбаді', lines: ['жим стоячи | 3x8', 'випади | 3x10'] },
    ],
    unreadable: 0,
  },
  // Sections inside a day, lists on the weekday line, more than one week, weights first, distances
  {
    id: 'en-sections-inside-weekdays',
    text: 'Monday\nWarm-up:\nBike 10 min\nMain:\nSquat 3x5\nBench 3x8\n\nWednesday\nSuperset:\nCurl 3x12\nPushdown 3x12\nCircuit:\nBurpee 3x10\nSwing 3x15\n\nFriday\nAccessories:\nFace pull 3x15',
    days: [
      { day: 0, lines: ['Bike | -x600s', 'Squat | 3x5', 'Bench | 3x8'] },
      { day: 2, lines: ['Curl | 3x12', 'Pushdown | 3x12 | ss', 'Burpee | 3x10', 'Swing | 3x15'] },
      { day: 4, lines: ['Face pull | 3x15'] },
    ],
  },
  {
    id: 'uk-sections-inside-weekdays',
    text: 'Понеділок\nРозминка:\nВелосипед 10 хв\nОсновна частина:\nПрисідання 4х6\nСуперсет:\nЗгинання рук 3х12\nРозгинання рук 3х12\n\nЧетвер\nЗаминка:\nРозтяжка 5 хв',
    days: [
      { day: 0, lines: ['Велосипед | -x600s', 'Присідання | 4x6', 'Згинання рук | 3x12', 'Розгинання рук | 3x12 | ss'] },
      { day: 3, lines: ['Розтяжка | -x300s'] },
    ],
  },
  {
    id: 'ru-sections-inside-weekdays',
    text: 'Среда\nРазминка:\nСкакалка 5 мин\nКруговая:\nБерпи 3х10\nВыпады 3х12\nПятница\nОсновная часть:\nСтановая тяга 3х5',
    days: [
      { day: 2, lines: ['Скакалка | -x300s', 'Берпи | 3x10', 'Выпады | 3x12'] },
      { day: 4, lines: ['Становая тяга | 3x5'] },
    ],
  },
  {
    id: 'en-list-on-weekday-line',
    text: 'Monday: Bench 3x8, Squat 3x5\nTuesday - Bench 3x8, Rows 3x10, Squat 3x5\nThursday: Bench press, Incline DB press, Flyes\nFriday (chest, triceps)\nDips 3x10',
    days: [
      { day: 0, lines: ['Bench | 3x8', 'Squat | 3x5'] },
      { day: 1, lines: ['Bench | 3x8', 'Rows | 3x10', 'Squat | 3x5'] },
      { day: 3, lines: ['Bench press', 'Incline DB press', 'Flyes'] },
      { day: 4, label: 'chest, triceps', lines: ['Dips | 3x10'] },
    ],
  },
  {
    id: 'uk-list-on-weekday-line',
    text: 'Пн: Жим лежачи 4х8, Тяга 3х10; Присідання 3х5\nЧт: Жим стоячи, Підтягування, Махи',
    days: [
      { day: 0, lines: ['Жим лежачи | 4x8', 'Тяга | 3x10', 'Присідання | 3x5'] },
      { day: 3, lines: ['Жим стоячи', 'Підтягування', 'Махи'] },
    ],
  },
  {
    id: 'ru-list-on-weekday-line',
    text: 'Понедельник - Жим лежа 3х8, Присед 3х5\nСреда: Подтягивания, Тяга штанги, Шраги',
    days: [
      { day: 0, lines: ['Жим лежа | 3x8', 'Присед | 3x5'] },
      { day: 2, lines: ['Подтягивания', 'Тяга штанги', 'Шраги'] },
    ],
  },
  {
    id: 'en-multi-week-reads-week-one',
    text: 'Week 1\nMonday\nBench 3x8\nThursday\nSquat 3x5\nWeek 2\nMonday\nBench 3x9\nThursday\nSquat 3x6\nWeek 3\nMonday\nBench 3x10',
    days: [
      { day: 0, lines: ['Bench | 3x8'] },
      { day: 3, lines: ['Squat | 3x5'] },
    ],
    skippedWeeks: 2,
  },
  {
    id: 'uk-multi-week-reads-week-one',
    text: 'Тиждень 1\nПн\nЖим 4х8\nЧт\nПрисід 4х6\n\nТиждень 2\nПн\nЖим 4х9\nЧт\nПрисід 4х7',
    days: [
      { day: 0, lines: ['Жим | 4x8'] },
      { day: 3, lines: ['Присід | 4x6'] },
    ],
    skippedWeeks: 1,
  },
  {
    id: 'ru-repeated-weekdays-are-a-second-week',
    text: 'Пн\nЖим 3х8\nЧт\nПрисед 3х5\nПн\nЖим 3х9\nЧт\nПрисед 3х6',
    days: [
      { day: 0, lines: ['Жим | 3x8'] },
      { day: 3, lines: ['Присед | 3x5'] },
    ],
    skippedWeeks: 1,
  },
  {
    id: 'en-weight-first-triples',
    text: 'Goblet squat 16x3x12\nDB curl 12x3x10\nBench 20x5x5\nSquat 100x5x5\nRow 3x10x60',
    days: [{ day: 0, lines: ['Goblet squat | 3x12 | check', 'DB curl | 3x10 | check', 'Bench | 5x5 | check', 'Squat | 5x5', 'Row | 3x10'] }],
  },
  {
    id: 'uk-ru-weight-first-triples',
    text: 'Гоблет присід 16х3х12\nЖим 80х5х5\nПодъём на бицепс 12х3х10',
    days: [{ day: 0, lines: ['Гоблет присід | 3x12 | check', 'Жим | 5x5', 'Подъём на бицепс | 3x10 | check'] }],
  },
  {
    id: 'en-distances-are-not-minutes',
    text: "Conditioning:\nFarmer's walk 3x40m\nSled push 4x20m rest 2m\nRun 400m",
    days: [{ day: 0, label: 'Conditioning', lines: ["Farmer's walk | 3x-", 'Sled push | 4x- | rest 120', 'Run'] }],
  },
  {
    id: 'uk-ru-distances-are-not-minutes',
    text: 'Прогулянка фермера 3х40 м\nШтовхання саней 4х20 м\nФермерская прогулка 3х40 метров',
    days: [{ day: 0, lines: ['Прогулянка фермера | 3x-', 'Штовхання саней | 4x-', 'Фермерская прогулка | 3x-'] }],
  },
  {
    id: 'en-title-before-week-one',
    text: '5/3/1 strength\nGoal: get stronger\nWeek 1\nMonday\nSquat 3x5\nBench 5x10\nThursday\nDeadlift 3x5\nWeek 2\nMonday\nSquat 3x5\nThursday\nDeadlift 3x3',
    days: [
      { day: 0, lines: ['Squat | 3x5', 'Bench | 5x10'] },
      { day: 3, lines: ['Deadlift | 3x5'] },
    ],
    unreadable: 1,
    skippedWeeks: 1,
  },
  {
    id: 'uk-title-before-week-one',
    text: 'Програма на 8 тижнів\nТиждень 1\nПн\nЖим 4х8\nЧт\nПрисід 4х6\nТиждень 2\nПн\nЖим 4х9',
    days: [
      { day: 0, lines: ['Жим | 4x8'] },
      { day: 3, lines: ['Присід | 4x6'] },
    ],
    skippedWeeks: 1,
  },
  {
    id: 'ru-title-before-week-one',
    text: 'Силовой блок\nЦель: сила\nНеделя 1\nПн\nЖим лежа 3х5\nЧт\nПрисед 3х5',
    days: [
      { day: 0, lines: ['Жим лежа | 3x5'] },
      { day: 3, lines: ['Присед | 3x5'] },
    ],
  },
  {
    id: 'en-two-a-day-is-not-a-second-week',
    text: 'Monday AM\nBench 3x8\nTuesday\nRow 3x8\nMonday PM\nSquat 3x5',
    days: [
      { day: 0, label: 'AM', lines: ['Bench | 3x8', 'Squat | 3x5'] },
      { day: 1, lines: ['Row | 3x8'] },
    ],
  },
  {
    id: 'en-one-weekday-again-is-another-session',
    text: 'Monday\nBench 3x8\nWednesday\nRow 3x10\nFriday\nSquat 3x5\nMonday\nDeadlift 1x5',
    days: [
      { day: 0, lines: ['Bench | 3x8', 'Deadlift | 1x5'] },
      { day: 2, lines: ['Row | 3x10'] },
      { day: 4, lines: ['Squat | 3x5'] },
    ],
  },
  {
    id: 'en-small-bare-m-is-minutes',
    text: 'Conditioning:\nBike 10m\nTreadmill 20m\nPlank 3x1m',
    days: [{ day: 0, label: 'Conditioning', lines: ['Bike | -x600s', 'Treadmill | -x1200s', 'Plank | 3x60s'] }],
  },
]
