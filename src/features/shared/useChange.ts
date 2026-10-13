import { useCallback } from 'react'
import { toastWithUndo } from '../../app/undo'
import { useCatalog } from '../../app/useCatalog'
import type { Program } from '../../domain/schema'
import { common } from '../../i18n/common'
import { getLocale } from '../../i18n/messages'
import { prefsStore } from '../../store/prefs.store'
import { programStore, type ProgramState } from '../../store/program.store'
import { dismissToast } from '../../ui/toast'
import { dayChanges, deltaText, weekDeltas, weekFor, type GroupDelta } from './delta'
import { sharedMessages } from './messages'
import { triggerPulse } from './pulse'

export type ChangeResult = { message: string; deltas: GroupDelta[] }

export type ChangeOptions = {
  /** false when a sheet shows the result itself (toasts sit under an open dialog). */
  toast?: boolean
  /** Say so when the action broke up a superset (drag reorder, move). */
  noteSplit?: boolean
}

type Describe = string | ((deltas: GroupDelta[]) => string)

const activeOf = (s: ProgramState) => (s.activeId ? (s.programs[s.activeId] ?? null) : null)

const pairCount = (p: Program | null) => p?.days.reduce((n, d) => n + d.entries.filter((e) => e.withPrev).length, 0) ?? 0

/**
 * Runs a program-store action, then reports the week delta: a toast with Undo and a pulse on
 * the affected map regions. Returns null when the action changed nothing.
 */
export function useChange() {
  const { catalog } = useCatalog()
  return useCallback(
    (describe: Describe, action: () => void, options: ChangeOptions = {}): ChangeResult | null => {
      const s0 = programStore.getState()
      const before = activeOf(s0)
      action()
      const s1 = programStore.getState()
      if (s1.programs === s0.programs && s1.activeId === s0.activeId) return null
      const after = activeOf(s1)

      let deltas: GroupDelta[] = []
      if (before && after && before.id === after.id) {
        const prefs = prefsStore.getState()
        const wb = weekFor(before, catalog, prefs)
        const wa = weekFor(after, catalog, prefs)
        deltas = weekDeltas(wb, wa)
        triggerPulse(
          deltas.map((d) => d.group),
          dayChanges(wb, wa),
        )
      }
      const locale = getLocale()
      const m = sharedMessages[locale]
      const described = typeof describe === 'function' ? describe(deltas) : describe
      const split = options.noteSplit && before && after && before.id === after.id && pairCount(after) < pairCount(before)
      const base = split ? m.supersetSplit(described) : described
      const detail = deltaText(deltas, 2, locale)
      const message = detail ? m.withDelta(base, detail) : base
      // A visible toast's Undo would now revert this change instead of the one it names.
      if (options.toast !== false) toastWithUndo(message)
      else dismissToast()
      return { message, deltas }
    },
    [catalog],
  )
}

/** When a sheet closes, its last change moves to a toast so Undo stays in reach. */
export function carryUndo(message: string | null): void {
  if (message && message !== common[getLocale()].undone && programStore.getState().lastChange) toastWithUndo(message)
}

export function undoLastChange(): boolean {
  return programStore.getState().undo()
}
