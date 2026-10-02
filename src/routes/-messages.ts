import type { ReactNode } from 'react'
import { dayName } from '../app/days'
import { groupName } from '../data/localize'
import { defineMessages } from '../i18n/messages'

// Files starting with "-" are not routes (TanStack Router ignore prefix).

const enList = (ids: readonly string[]) => ids.map((g) => groupName(g, 'en').toLowerCase()).join(', ')
const ukList = (ids: readonly string[]) => ids.map((g) => groupName(g, 'uk').toLocaleLowerCase('uk')).join(', ')

export const rootMessages = defineMessages({
  en: {
    skip: 'Skip to content',
    plan: 'Plan',
    notFound: { title: 'Not found', heading: 'This page does not exist', action: 'Go to Plan', body: 'The link may be old or mistyped.' },
    error: {
      title: 'Something broke',
      heading: 'This screen failed to load',
      action: 'Try again',
      body: 'Your programs are saved on this device and are not affected.',
    },
  },
  uk: {
    skip: 'Перейти до вмісту',
    plan: 'План',
    notFound: {
      title: 'Не знайдено',
      heading: 'Такої сторінки немає',
      action: 'Перейти до плану',
      body: 'Можливо, посилання застаріле або містить помилку.',
    },
    error: {
      title: 'Щось зламалося',
      heading: 'Не вдалося завантажити цей екран',
      action: 'Спробувати ще раз',
      body: 'Ваші програми збережено на цьому пристрої, їх це не зачепило.',
    },
  },
})

export const bodyMessages = defineMessages({
  en: {
    title: 'Body',
    scope: 'Scope',
    week: 'Week',
    views: 'Views',
    both: 'Both',
    front: 'Front',
    back: 'Back',
    shading: 'Show',
    groups: 'Muscles',
    heads: 'Detail',
    mapOptions: 'Map options',
    mapOptionsHint: 'Detail shades the parts inside each muscle, like the three heads of the shoulder.',
    mapWeek: 'Weekly volume by muscle. The coverage list below has the same information.',
    mapDay: (day: number) => `Volume on ${dayName(day, 'long', 'en')} by muscle. The coverage list below has the same information.`,
  },
  uk: {
    title: 'Тіло',
    scope: 'Період',
    week: 'Тиждень',
    views: 'Вигляд',
    both: 'Обидва',
    front: 'Спереду',
    back: 'Ззаду',
    shading: 'Показати',
    groups: 'Мʼязи',
    heads: 'Детально',
    mapOptions: 'Параметри мапи',
    mapOptionsHint: '«Детально» зафарбовує частини всередині кожного мʼяза, як-от три пучки дельти.',
    mapWeek: 'Тижневий обсяг за мʼязами. У списку охоплення нижче та сама інформація.',
    mapDay: (day) => `Обсяг ${dayName(day, 'on', 'uk')} за мʼязами. У списку охоплення нижче та сама інформація.`,
  },
})

export const aboutMessages = defineMessages({
  en: {
    title: 'About',
    intro:
      'Plan a weekly gym program and see which muscles each day and the whole week train, down to individual muscle heads. Everything runs in your browser and stays on your device.',
    notMedicalTitle: 'Not medical advice',
    notMedicalBody:
      'The app helps you lay out a training week. It does not diagnose, treat or prevent any injury or condition, and it is not a rehabilitation tool. If you have an injury, pain or a health condition, talk to a qualified professional about what suits you.',
    numbersTitle: 'What the numbers mean',
    hardSetsLead: 'Working sets.',
    hardSets: 'Working sets taken reasonably close to failure. Warm-up sets are not counted. One-sided exercises count each set once, not per side.',
    fractionalLead: 'Fractional counting.',
    fractional:
      'A set counts 1 for each primary muscle group and 0.5 for each secondary one, following Pelland et al. 2026. The "primary only" setting counts secondary muscles as 0. Muscles that only stabilize count 0.',
    bandsLead: 'Weekly bands.',
    bands: "Each muscle group's weekly sets fall into a band. The words are neutral labels, not grades.",
    bandNote: {
      moderate: 'reads as good for general fitness under the General goal',
      target: 'the range most muscle growth studies use',
      high: 'each extra set adds less than the ones before it',
    } as Partial<Record<string, string>>,
    customRanges: (items: readonly { id: string; target: string }[]) =>
      `Some groups use their own ranges, labeled expert opinion: ${items.map((g) => `${groupName(g.id, 'en').toLowerCase()} ${g.target}`).join(', ')}.`,
    optionalGroups: (ids: readonly string[], target: string, below: number) =>
      `Optional groups (${enList(ids)}) show "${target}" and read "some sets" instead of light below ${below} weekly sets.`,
    trackedGroups: (ids: readonly string[]) => `${ids.map((g) => groupName(g, 'en')).join(', ')} are tracked as a number only, without a band.`,
    mapLead: 'Map colors.',
    map: 'One color, from light to strong, follows the same bands. The week scale uses weekly sets; the day scale uses one session. Heads are shaded by how much each exercise emphasizes them and never get a band.',
    daysLead: 'Training days per muscle.',
    days: 'The app lists the days a group gets 2 or more sets and the gaps between them. It is information only.',
    sourcesTitle: 'Sources',
    sourcesDescription: 'Studies and references behind muscle roles and set ranges.',
    usedFor: 'Used for:',
    sourcesNote:
      'Muscle roles are our own mapping. Where no study backs a call, the exercise says so with a low or medium confidence.',
    credits: 'Credits and licenses',
    privacy: 'Privacy',
  },
  uk: {
    title: 'Про застосунок',
    intro:
      'Плануйте тижневу програму тренувань і дивіться, які мʼязи тренує кожен день і весь тиждень, аж до окремих пучків. Усе працює у вашому браузері й залишається на вашому пристрої.',
    notMedicalTitle: 'Не медична порада',
    notMedicalBody:
      'Застосунок допомагає скласти тренувальний тиждень. Він не діагностує, не лікує й не запобігає травмам чи захворюванням і не є інструментом реабілітації. Якщо у вас травма, біль або проблеми зі здоровʼям, порадьтеся з кваліфікованим фахівцем щодо того, що вам підходить.',
    numbersTitle: 'Що означають числа',
    hardSetsLead: 'Робочі підходи.',
    hardSets:
      'Підходи, виконані досить близько до відмови. Розминкові підходи не враховуються. В односторонніх вправах кожен підхід рахується один раз, а не для кожної сторони.',
    fractionalLead: 'Дробовий підрахунок.',
    fractional:
      'Підхід рахується як 1 для кожної основної групи мʼязів і як 0,5 для кожної допоміжної, за Pelland et al. 2026. Налаштування «Лише основні» рахує допоміжні мʼязи як 0. Мʼязи, які лише стабілізують, рахуються як 0.',
    bandsLead: 'Тижневі діапазони.',
    bands: 'Тижневі підходи кожної групи мʼязів потрапляють у певний діапазон. Ці слова є нейтральними позначками, а не оцінками.',
    bandNote: {
      moderate: 'з метою «Загальна форма» читається як «добре для загальної форми»',
      target: 'діапазон, який використовує більшість досліджень росту мʼязів',
      high: 'кожен додатковий підхід дає менше, ніж попередні',
    },
    customRanges: (items) =>
      `Деякі групи мають власні діапазони, позначені як експертна думка: ${items.map((g) => `${groupName(g.id, 'uk').toLocaleLowerCase('uk')} ${g.target}`).join(', ')}.`,
    optionalGroups: (ids, target, below) =>
      `Необовʼязкові групи (${ukList(ids)}) показують «${target}», а нижче ${below} підходів на тиждень мають позначку «кілька підходів» замість «мало».`,
    trackedGroups: (ids) => `${ids.map((g) => groupName(g, 'uk')).join(', ')} враховуються лише числом, без діапазону.`,
    mapLead: 'Кольори мапи.',
    map: 'Один колір, від світлого до насиченого, відповідає тим самим діапазонам. Тижнева шкала враховує підходи за тиждень, а денна одне тренування. Пучки зафарбовано залежно від того, наскільки кожна вправа на них акцентує, і вони ніколи не отримують діапазону.',
    daysLead: 'Тренувальні дні для кожного мʼяза.',
    days: 'Застосунок показує дні, коли група отримує 2 або більше підходів, і проміжки між ними. Це лише інформація.',
    sourcesTitle: 'Джерела',
    sourcesDescription: 'Дослідження та джерела, на яких ґрунтуються ролі мʼязів і діапазони підходів.',
    usedFor: 'Використано для:',
    sourcesNote:
      'Ролі мʼязів розмічено нами. Якщо рішення не підтверджене дослідженням, у вправі зазначено низьку або середню впевненість.',
    credits: 'Подяки та ліцензії',
    privacy: 'Конфіденційність',
  },
})

export const creditsMessages = defineMessages({
  en: {
    title: 'Credits',
    footer: (notices: ReactNode, privacy: ReactNode, about: ReactNode): ReactNode[] => [
      'Full license texts of bundled libraries: ',
      notices,
      '. See also ',
      privacy,
      ' and ',
      about,
      '.',
    ],
    privacy: 'privacy',
    about: 'about',
  },
  uk: {
    title: 'Подяки',
    footer: (notices, privacy, about) => ['Повні тексти ліцензій вбудованих бібліотек: ', notices, '. Див. також ', privacy, ' і ', about, '.'],
    privacy: 'конфіденційність',
    about: 'про застосунок',
  },
})

export const privacyMessages = defineMessages({
  en: {
    title: 'Privacy',
    subtitle: 'Short version: your programs never leave your device unless you share them.',
    whoTitle: 'Who runs this app',
    contact: (name: string, contact: string) => `${name}. Contact: ${contact}`,
    operatorPlaceholder: 'Operator name and contact details go here before public launch.',
    noOperator: 'An independent developer. Contact details will be added to this page.',
    trackingTitle: 'No accounts, no tracking',
    tracking:
      "There is no sign-up, no server database, no analytics, no ads and no cookies. The app never loads anything from other companies' servers while you use it.",
    storedTitle: 'What is stored on this device',
    stored: [
      'Your programs, including custom exercises, day labels and notes.',
      'Your settings: goal, equipment, counting mode, week start and "Edit how this counts" changes.',
      'Small flags, for example whether you dismissed the install card.',
      "An offline copy of the app's own files, so it opens without a connection.",
    ] as readonly string[],
    storedNote:
      "This lives in your browser's storage for this site. Nobody else can read it, including us. Nothing here is sent anywhere unless you export a file or share a link.",
    deleteTitle: 'How to delete it',
    delete:
      'Remove the site data for this site in your browser settings. On iPhone and iPad: Settings, Safari, Advanced, Website Data. In Chrome: Settings, Privacy and security, Site settings. If you added the app to your Home Screen, deleting the app removes its data too. Export a backup first if you want to keep your programs.',
    deleteSafari: 'Safari may also clear data for sites you have not opened for 7 days. Apps added to the Home Screen are not affected.',
    shareTitle: 'Share links',
    share:
      'A share link carries the whole program in the part of the address after the #. Browsers do not send that part to any server, so the program is not uploaded or stored anywhere. Anyone who has the link can read the program, including its name, day labels, notes and custom exercise names.',
    claudeTitle: 'Building a program with Claude',
    claude:
      "If you connect Claude to this site, Claude sends the program it drafts to this site's server, which checks it and turns it into a share link. The program is handled in memory and not stored. This only happens when you use that connection; the app itself never sends your programs anywhere. What you tell Claude is covered by Anthropic's terms, not this page.",
    hostingTitle: 'Hosting',
    hosting: (policy: ReactNode): ReactNode[] => [
      "The app's files are served by Vercel Inc. as a processor on our behalf. To deliver them, Vercel handles standard request data such as your IP address, browser type, the address requested and the time, and may keep it briefly in logs for security and reliability. See ",
      policy,
      '.',
    ],
    vercelPolicy: "Vercel's privacy policy",
    cookieTitle: 'Why there is no cookie banner',
    cookie:
      'The storage above is strictly needed for the app to work and stays on your device, so no consent is required. If analytics or anything similar is ever added, this page will change first.',
    about: 'About the app',
    credits: 'Credits',
  },
  uk: {
    title: 'Конфіденційність',
    subtitle: 'Коротко: ваші програми не залишають пристрій, якщо ви ними не поділитеся.',
    whoTitle: 'Хто керує застосунком',
    contact: (name, contact) => `${name}. Контакт: ${contact}`,
    operatorPlaceholder: 'Тут перед публічним запуском буде імʼя оператора та контактні дані.',
    noOperator: 'Незалежний розробник. Контактні дані буде додано на цю сторінку.',
    trackingTitle: 'Без облікових записів і відстеження',
    tracking:
      'Немає реєстрації, серверної бази даних, аналітики, реклами чи файлів cookie. Під час роботи застосунок нічого не завантажує із серверів інших компаній.',
    storedTitle: 'Що зберігається на цьому пристрої',
    stored: [
      'Ваші програми, зокрема власні вправи, назви днів і нотатки.',
      'Ваші налаштування: мета, обладнання, режим підрахунку, початок тижня та зміни через «Змінити підрахунок».',
      'Невеликі позначки, наприклад, чи закрили ви картку встановлення.',
      'Офлайн-копія файлів самого застосунку, щоб він відкривався без підключення.',
    ],
    storedNote:
      'Це зберігається у сховищі вашого браузера для цього сайту. Ніхто інший не може це прочитати, зокрема й ми. Звідси нічого нікуди не надсилається, якщо ви не експортуєте файл або не поділитеся посиланням.',
    deleteTitle: 'Як це видалити',
    delete:
      'Видаліть дані цього сайту в налаштуваннях браузера. На iPhone та iPad: Параметри, Safari, Додатково, Дані вебсайтів. У Chrome: Налаштування, Конфіденційність і безпека, Налаштування сайтів. Якщо ви додали застосунок на початковий екран, його видалення також стирає його дані. Щоб зберегти програми, спершу експортуйте резервну копію.',
    deleteSafari: 'Safari також може видаляти дані сайтів, які ви не відкривали 7 днів. Це не стосується застосунків, доданих на початковий екран.',
    shareTitle: 'Посилання',
    share:
      'Посилання містить усю програму в частині адреси після #. Браузери не надсилають цю частину на жоден сервер, тому програма ніде не завантажується й не зберігається. Будь-хто, хто має посилання, може переглянути програму, зокрема її назву, назви днів, нотатки та назви власних вправ.',
    claudeTitle: 'Створення програми з Claude',
    claude:
      'Якщо ви підключите Claude до цього сайту, Claude надсилає складену програму на сервер цього сайту, який перевіряє її та перетворює на посилання. Програма обробляється в памʼяті й не зберігається. Це відбувається лише тоді, коли ви користуєтеся цим підключенням; сам застосунок ніколи нікуди не надсилає ваші програми. Те, що ви повідомляєте Claude, регулюють умови Anthropic, а не ця сторінка.',
    hostingTitle: 'Хостинг',
    hosting: (policy) => [
      'Файли застосунку надає Vercel Inc. як обробник даних від нашого імені. Щоб доставити їх, Vercel обробляє стандартні дані запиту, як-от вашу IP-адресу, тип браузера, запитану адресу та час, і може ненадовго зберігати їх у журналах для безпеки й надійності. Див. ',
      policy,
      '.',
    ],
    vercelPolicy: 'політику конфіденційності Vercel',
    cookieTitle: 'Чому немає банера cookie',
    cookie:
      'Описане вище сховище суворо необхідне для роботи застосунку й залишається на вашому пристрої, тож згода не потрібна. Якщо колись буде додано аналітику чи щось подібне, спершу зміниться ця сторінка.',
    about: 'Про застосунок',
    credits: 'Подяки',
  },
})
