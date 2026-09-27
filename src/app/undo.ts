import { useEffect } from 'react'
import { programStore } from '../store/program.store'
import { showToast } from '../ui/toast'

/** Toast for a program change with a one-step Undo (the store keeps one snapshot). */
export function toastWithUndo(message: string): void {
  showToast({
    message,
    action: {
      label: 'Undo',
      onAction: () => {
        if (programStore.getState().undo()) showToast({ message: 'Undone' })
      },
    },
  })
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

/** Cmd/Ctrl+Z undoes the last program change when focus is not in a text field. */
export function useUndoShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || isTyping(e.target)) return
      if (programStore.getState().undo()) {
        e.preventDefault()
        showToast({ message: 'Undone' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
