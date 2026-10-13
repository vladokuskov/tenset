import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

const TITLE = '#content h1[tabindex="-1"]'
const WAIT_MS = 3000

/** Lazy screens can render their header a moment after the route resolves. */
function focusPageTitle(): () => void {
  const tryFocus = () => {
    const h1 = document.querySelector<HTMLElement>(TITLE)
    if (!h1) return false
    if (!document.querySelector('dialog[open]')) h1.focus({ preventScroll: true })
    return true
  }
  if (tryFocus()) return () => {}
  const content = document.getElementById('content')
  if (!content) return () => {}
  const observer = new MutationObserver(() => {
    if (tryFocus()) stop()
  })
  const timer = window.setTimeout(() => stop(), WAIT_MS)
  const stop = () => {
    observer.disconnect()
    window.clearTimeout(timer)
  }
  observer.observe(content, { childList: true, subtree: true })
  return stop
}

/** Moves focus to the page title when the path changes (not on first load or ?sheet= changes), so screen readers announce the new screen. */
export function useFocusTitleOnNavigate(): void {
  const router = useRouter()
  useEffect(() => {
    let cancel = () => {}
    const unsubscribe = router.subscribe('onRendered', ({ fromLocation, pathChanged }) => {
      if (!fromLocation || !pathChanged) return
      cancel()
      cancel = focusPageTitle()
    })
    return () => {
      unsubscribe()
      cancel()
    }
  }, [router])
}
