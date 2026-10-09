import { useCallback, useRef } from 'react'

/**
 * Ref for a scroll container with the `scroll-fade` utility: flags whether more content sits above
 * or below, so only those edges fade. Macs hide scrollbars, and the fade is the only overflow hint.
 */
export function useScrollFade<T extends HTMLElement>() {
  const cleanup = useRef<(() => void) | null>(null)
  return useCallback((el: T | null) => {
    cleanup.current?.()
    cleanup.current = null
    if (!el) return
    const update = () => {
      const above = el.scrollTop > 1
      const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1
      el.toggleAttribute('data-more-above', above)
      el.toggleAttribute('data-more-below', below)
    }
    const resize = new ResizeObserver(update)
    const watch = () => {
      resize.disconnect()
      resize.observe(el)
      for (const child of el.children) resize.observe(child)
    }
    const mutations = new MutationObserver(() => {
      watch()
      update()
    })
    watch()
    mutations.observe(el, { childList: true })
    el.addEventListener('scroll', update, { passive: true })
    update()
    cleanup.current = () => {
      resize.disconnect()
      mutations.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [])
}
