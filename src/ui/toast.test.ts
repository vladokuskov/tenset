import { beforeEach, expect, test } from 'vitest'
import { dismissToast, showToast, toastStore } from './toast'

beforeEach(() => toastStore.setState({ current: null, queued: null }))

test('an ordinary toast replaces another', () => {
  showToast({ message: 'a' })
  showToast({ message: 'b' })
  expect(toastStore.getState().current?.message).toBe('b')
})

test('an ordinary toast waits behind an important one and shows when it closes', () => {
  const warning = showToast({ message: 'not saved', important: true })
  showToast({ message: 'first change' })
  showToast({ message: 'second change' })
  expect(toastStore.getState().current?.message).toBe('not saved')
  dismissToast(warning)
  expect(toastStore.getState().current?.message).toBe('second change')
  expect(toastStore.getState().queued).toBeNull()
})

test('dismissing without an id keeps the important toast and drops the queued one', () => {
  showToast({ message: 'not saved', important: true })
  showToast({ message: 'change' })
  dismissToast()
  expect(toastStore.getState()).toMatchObject({ current: { message: 'not saved' }, queued: null })
})
