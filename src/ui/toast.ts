import { createStore } from 'zustand/vanilla'

export type ToastAction = { label: string; onAction: () => void }

export type Toast = {
  id: number
  message: string
  action?: ToastAction
  /** ms before it hides; paused while hovered or focused. */
  duration: number
}

export type ToastInput = { message: string; action?: ToastAction; duration?: number }

type ToastState = { current: Toast | null }

export const toastStore = createStore<ToastState>(() => ({ current: null }))

let nextId = 1

/** Shows a toast, replacing any visible one. Returns its id. */
export function showToast({ message, action, duration }: ToastInput): number {
  const id = nextId++
  toastStore.setState({ current: { id, message, action, duration: duration ?? (action ? 6000 : 3500) } })
  return id
}

export function dismissToast(id?: number): void {
  const { current } = toastStore.getState()
  if (current && (id === undefined || current.id === id)) toastStore.setState({ current: null })
}
