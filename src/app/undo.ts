import { useEffect } from 'react'
import { common } from '../i18n/common'
import { getMessages } from '../i18n/messages'
import { programStore } from '../store/program.store'
import { showToast } from '../ui/toast'

/** Toast for a program change with a one-step Undo (the store keeps one snapshot). */
export function toastWithUndo(message: string): void {
  showToast({
    message,
    action: {
      label: getMessages(common).undo,
      onAction: () => {
        if (programStore.getState().undo()) showToast({ message: getMessages(common).undone })
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
        showToast({ message: getMessages(common).undone })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
