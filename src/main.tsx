import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { whenIdle } from './app/idle'
import { loadExerciseText } from './data/localize'
import { getLocale } from './i18n/messages'
import { routeTree } from './routeTree.gen'
import { RouteError } from './routes/-RouteError'
import './styles/app.css'

const router = createRouter({ routeTree, defaultErrorComponent: RouteError })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// English names are on the records; other languages wait for their names so the first screen does not switch language.
const locale = getLocale()
void (locale === 'en' ? Promise.resolve() : loadExerciseText(locale))
  .catch(() => undefined)
  .then(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    ),
  )

if (import.meta.env.PROD) whenIdle(() => void import('./sw/warmPosters').then((m) => m.startPosterWarming()))
