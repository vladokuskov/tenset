import { useEffect, useState } from 'react'

const CHECK_EVERY_MS = 60 * 60 * 1000

/**
 * True once a new service worker has installed and is waiting. The worker itself is registered
 * by the plugin's registerSW.js; this only watches it. `apply` swaps it in and reloads once.
 */
export function useServiceWorkerUpdate(): { ready: boolean; apply: () => void } {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
    if (!sw || import.meta.env.DEV) return
    let alive = true
    let lastCheck = Date.now()
    let registration: ServiceWorkerRegistration | undefined

    const track = (worker: ServiceWorker | null) => {
      if (!worker) return
      const onState = () => {
        if (worker.state === 'installed' && sw.controller && alive) setWaiting(worker)
      }
      worker.addEventListener('statechange', onState)
      onState()
    }
    const onUpdateFound = () => track(registration?.installing ?? null)
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !registration) return
      if (Date.now() - lastCheck < CHECK_EVERY_MS) return
      lastCheck = Date.now()
      void registration.update().catch(() => undefined)
    }

    void sw.ready.then((reg) => {
      if (!alive) return
      registration = reg
      if (reg.waiting && sw.controller) setWaiting(reg.waiting)
      track(reg.installing)
      reg.addEventListener('updatefound', onUpdateFound)
    })
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      registration?.removeEventListener('updatefound', onUpdateFound)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const apply = () => {
    const sw = navigator.serviceWorker
    if (!waiting || !sw) return
    let reloaded = false
    sw.addEventListener('controllerchange', () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    })
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  return { ready: waiting !== null, apply }
}
