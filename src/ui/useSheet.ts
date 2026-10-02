import { useNavigate, useRouter, useRouterState, useSearch, type HistoryState } from '@tanstack/react-router'
import { useCallback } from 'react'

const STATE_KEY = 'gbSheet'

type SearchRecord = Record<string, unknown>

/** History state for navigating to another route with a sheet open, so closing it goes back here. */
export const sheetState = (name: string) => ((prev: HistoryState) => ({ ...prev, [STATE_KEY]: name })) as never

export type SheetControl = {
  open: boolean
  /** Pushes a history entry with ?sheet=<name> plus any extra params, so back closes it. */
  show: (params?: SearchRecord) => void
  /** Changes params while the sheet is open without adding history entries. */
  update: (params: SearchRecord) => void
  /** Goes back when this sheet was opened in-app, otherwise strips its params in place. */
  close: () => void
  /** Replaces this sheet with another one in the same history entry (e.g. menu -> share). */
  switchTo: (name: string, params?: SearchRecord) => void
  /** Current search params (loosely typed; read typed ones with Route.useSearch()). */
  search: SearchRecord
}

/**
 * URL-driven sheet state. `params` are the extra search keys the sheet owns and removes on close.
 * Every route that hosts a sheet must list its name in the route's `sheet` search enum.
 */
export function useSheet(name: string, params: readonly string[] = []): SheetControl {
  const router = useRouter()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as SearchRecord
  const openedHere = useRouterState({
    select: (s) => (s.location.state as HistoryState & { [STATE_KEY]?: string })[STATE_KEY] === name,
  })
  const open = search.sheet === name
  const paramsKey = params.join(',')

  const show = useCallback(
    (extra: SearchRecord = {}) => {
      void navigate({
        to: '.',
        search: ((prev: SearchRecord) => ({ ...prev, ...extra, sheet: name })) as never,
        state: sheetState(name),
      })
    },
    [navigate, name],
  )

  const update = useCallback(
    (patch: SearchRecord) => {
      void navigate({
        to: '.',
        search: ((prev: SearchRecord) => ({ ...prev, ...patch })) as never,
        state: ((prev: HistoryState) => prev) as never,
        replace: true,
      })
    },
    [navigate],
  )

  const close = useCallback(() => {
    if (openedHere && router.history.canGoBack()) {
      router.history.back()
      return
    }
    const owned = ['sheet', ...paramsKey.split(',').filter(Boolean)]
    void navigate({
      to: '.',
      search: ((prev: SearchRecord) =>
        Object.fromEntries(Object.entries(prev).filter(([k]) => !owned.includes(k)))) as never,
      replace: true,
    })
  }, [openedHere, router, navigate, paramsKey])

  const switchTo = useCallback(
    (next: string, extra: SearchRecord = {}) => {
      const owned = ['sheet', ...paramsKey.split(',').filter(Boolean)]
      void navigate({
        to: '.',
        search: ((prev: SearchRecord) => ({
          ...Object.fromEntries(Object.entries(prev).filter(([k]) => !owned.includes(k))),
          ...extra,
          sheet: next,
        })) as never,
        state: ((prev: HistoryState) => ({ ...prev, [STATE_KEY]: openedHere ? next : undefined })) as never,
        replace: true,
      })
    },
    [navigate, paramsKey, openedHere],
  )

  return { open, show, update, close, switchTo, search }
}
