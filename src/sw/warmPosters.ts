import { whenIdle } from '../app/idle'
import { activeExercises, catalog } from '../data/catalog'
import type { CountingModeValue, Overrides } from '../domain/resolve'
import type { Program } from '../domain/schema'
import { alternativesFor } from '../features/catalog/alternatives'
import { posterUrl } from '../features/catalog/posters'
import { prefsStore } from '../store/prefs.store'
import { programStore } from '../store/program.store'

export type WarmPrefs = { equipment: Iterable<string>; countingMode: CountingModeValue; overrides: Overrides }

/** Posters shown for the exercises in the programs and the alternatives their detail pages list. */
export function programPosters(programs: readonly Program[], prefs: WarmPrefs): string[] {
  const available = [...prefs.equipment]
  const ids = new Set<number>()
  for (const program of programs) {
    const ctx = { catalog, custom: program.custom, countingMode: prefs.countingMode, overrides: prefs.overrides }
    for (const day of program.days) {
      for (const entry of day.entries) {
        const exercise = typeof entry.exerciseId === 'number' ? catalog.get(entry.exerciseId) : undefined
        if (!exercise || ids.has(exercise.id)) continue
        ids.add(exercise.id)
        for (const alt of alternativesFor(exercise, activeExercises, available, ctx)) ids.add(alt.exercise.id)
      }
    }
  }
  return [...ids].flatMap((id) => {
    const url = catalog.get(id)?.media.status === 'loop' ? posterUrl(id) : null
    return url ? [url] : []
  })
}

/**
 * Posters are cached on first view, so offline an unseen one falls back to the map card. At idle, and again when
 * the programs change, this asks the service worker to cache the ones the user's own days and swaps show.
 */
export function startPosterWarming(): void {
  const sw = navigator.serviceWorker as ServiceWorkerContainer | undefined
  if (!sw) return
  const sent = new Set<string>()
  let cancel: (() => void) | null = null
  const warm = () => {
    cancel = null
    const urls = programPosters(Object.values(programStore.getState().programs), prefsStore.getState()).filter((u) => !sent.has(u))
    if (urls.length === 0) return
    for (const u of urls) sent.add(u)
    void sw.ready.then((reg) => reg.active?.postMessage({ type: 'WARM_POSTERS', urls }))
  }
  const schedule = () => {
    cancel ??= whenIdle(warm)
  }
  schedule()
  programStore.subscribe(schedule)
  prefsStore.subscribe(schedule)
}
