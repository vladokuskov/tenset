import type { ReactNode } from 'react'
import { defineMessages } from '../i18n/messages'

// Files starting with "-" are not routes (TanStack Router ignore prefix).

export const rootMessages = defineMessages({
  en: {
    skip: 'Skip to content',
    library: 'Exercises',
    notFound: { title: 'Not found', heading: 'This page does not exist', action: 'Go to exercises', body: 'The link may be old or mistyped.' },
    error: {
      title: 'Something broke',
      heading: 'This screen failed to load',
      action: 'Try again',
      body: 'Reload the page or try again in a moment.',
    },
    titles: {
      exercises: 'Exercises',
      credits: 'Credits',
      privacy: 'Privacy',
    },
  },
  uk: {
    skip: 'Перейти до вмісту',
    library: 'Вправи',
    notFound: {
      title: 'Не знайдено',
      heading: 'Такої сторінки немає',
      action: 'Перейти до вправ',
      body: 'Можливо, посилання застаріле або містить помилку.',
    },
    error: {
      title: 'Щось зламалося',
      heading: 'Не вдалося завантажити цей екран',
      action: 'Спробувати ще раз',
      body: 'Перезавантажте сторінку або спробуйте ще раз за мить.',
    },
    titles: {
      exercises: 'Вправи',
      credits: 'Подяки',
      privacy: 'Конфіденційність',
    },
  },
})

export const creditsMessages = defineMessages({
  en: {
    title: 'Credits',
    footer: (notices: ReactNode, privacy: ReactNode): ReactNode[] => [
      'Full license texts of bundled libraries: ',
      notices,
      '. See also ',
      privacy,
      '.',
    ],
    privacy: 'privacy',
  },
  uk: {
    title: 'Подяки',
    footer: (notices, privacy) => ['Повні тексти ліцензій вбудованих бібліотек: ', notices, '. Див. також ', privacy, '.'],
    privacy: 'конфіденційність',
  },
})

export const privacyMessages = defineMessages({
  en: {
    title: 'Privacy',
    subtitle: 'Short version: nothing about you leaves your device.',
    whoTitle: 'Who runs this app',
    contact: (name: string, contact: string) => `${name}. Contact: ${contact}`,
    operatorPlaceholder: 'Operator name and contact details go here before public launch.',
    noOperator: 'An independent developer. Contact details will be added to this page.',
    trackingTitle: 'No accounts, no tracking',
    tracking:
      "There is no sign-up, no server database, no analytics, no ads and no cookies. The app never loads anything from other companies' servers while you use it.",
    storedTitle: 'What is stored on this device',
    stored: [
      'Your language and the equipment you picked.',
      "An offline copy of the app's own files and the exercise videos you have seen, so it opens without a connection.",
    ] as readonly string[],
    storedNote:
      "This lives in your browser's storage for this site. Nobody else can read it, including us, and it is never sent anywhere.",
    deleteTitle: 'How to delete it',
    delete:
      'Remove the site data for this site in your browser settings. On iPhone and iPad: Settings, Safari, Advanced, Website Data. In Chrome: Settings, Privacy and security, Site settings. If you added the app to your Home Screen, deleting the app removes its data too.',
    deleteSafari: 'Safari may also clear data for sites you have not opened for 7 days. Apps added to the Home Screen are not affected.',
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
    credits: 'Credits',
  },
  uk: {
    title: 'Конфіденційність',
    subtitle: 'Коротко: жодні дані про вас не залишають пристрій.',
    whoTitle: 'Хто керує застосунком',
    contact: (name, contact) => `${name}. Контакт: ${contact}`,
    operatorPlaceholder: 'Тут перед публічним запуском буде імʼя оператора та контактні дані.',
    noOperator: 'Незалежний розробник. Контактні дані буде додано на цю сторінку.',
    trackingTitle: 'Без облікових записів і відстеження',
    tracking:
      'Немає реєстрації, серверної бази даних, аналітики, реклами чи файлів cookie. Під час роботи застосунок нічого не завантажує із серверів інших компаній.',
    storedTitle: 'Що зберігається на цьому пристрої',
    stored: [
      'Вибрана мова та обладнання.',
      'Офлайн-копія файлів самого застосунку та переглянутих відео вправ, щоб він відкривався без підключення.',
    ],
    storedNote:
      'Це зберігається у сховищі вашого браузера для цього сайту. Ніхто інший не може це прочитати, зокрема й ми, і це нікуди не надсилається.',
    deleteTitle: 'Як це видалити',
    delete:
      'Видаліть дані цього сайту в налаштуваннях браузера. На iPhone та iPad: Параметри, Safari, Додатково, Дані вебсайтів. У Chrome: Налаштування, Конфіденційність і безпека, Налаштування сайтів. Якщо ви додали застосунок на початковий екран, його видалення також стирає його дані.',
    deleteSafari: 'Safari також може видаляти дані сайтів, які ви не відкривали 7 днів. Це не стосується застосунків, доданих на початковий екран.',
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
    credits: 'Подяки',
  },
})
