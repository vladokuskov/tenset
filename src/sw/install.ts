export type InstallEnv = {
  userAgent: string
  /** navigator.standalone: iOS Safari only, true when launched from the Home Screen. */
  standalone?: boolean
  /** matchMedia('(display-mode: standalone)') */
  displayStandalone: boolean
  maxTouchPoints: number
}

export type InstallPlatform = 'ios' | 'mac'

const OTHER_BROWSERS = /CriOS|FxiOS|EdgiOS|EdgA?\/|OPiOS|OPR\/|Chrome\/|Chromium|GSA\/|DuckDuckGo|FBAN|FBAV|Instagram|Line\//

/** Safari in a normal tab (not installed), where site data can be cleared after 7 days without a visit. */
export function safariTabPlatform(env: InstallEnv): InstallPlatform | null {
  if (env.displayStandalone || env.standalone === true) return null
  const ua = env.userAgent
  if (!/Safari\//.test(ua) || OTHER_BROWSERS.test(ua)) return null
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1)) return 'ios'
  const version = Number(ua.match(/Version\/(\d+)/)?.[1] ?? 0)
  if (/Macintosh/.test(ua) && version >= 17) return 'mac'
  return null
}

export function currentInstallEnv(): InstallEnv | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return null
  return {
    userAgent: navigator.userAgent,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    displayStandalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  }
}

/** Program changes that are not the user's own edit (creating or importing a program). */
export const NOT_AN_EDIT = new Set(['createBlank', 'createFromTemplate', 'importProgram', 'duplicateProgram'])
