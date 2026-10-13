import { createStore } from 'zustand/vanilla'

export type ToastAction = { label: string; onAction: () => void }

export type Toast = {
  id: number
  message: string
  action?: ToastAction
  /** ms before it hides; paused while hovered or focused. */
  duration: number
  /** Ordinary toasts wait behind it instead of replacing it. */
  important?: boolean
}

export type ToastInput = { message: string; action?: ToastAction; duration?: number; important?: boolean }

type ToastState = { current: Toast | null; queued: Toast | null }

export const toastStore = createStore<ToastState>(() => ({ current: null, queued: null }))

let nextId = 1

/** Shows a toast, replacing any visible one unless that one is important. Returns its id. */
export function showToast({ message, action, duration, important }: ToastInput): number {
  const id = nextId++
  const toast: Toast = { id, message, action, duration: duration ?? (action ? 6000 : 3500), important }
  const { current } = toastStore.getState()
  if (current?.important && !important) toastStore.setState({ queued: toast })
  else toastStore.setState({ current: toast })
  return id
}

/** Without an id, hides any ordinary toast but leaves an important one up. */
export function dismissToast(id?: number): void {
  const { current, queued } = toastStore.getState()
  if (id === undefined) {
    if (current && !current.important) toastStore.setState({ current: null })
    if (queued) toastStore.setState({ queued: null })
    return
  }
  if (queued?.id === id) toastStore.setState({ queued: null })
  else if (current?.id === id) toastStore.setState({ current: queued, queued: null })
}
