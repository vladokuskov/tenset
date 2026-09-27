import { Share, SquarePlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { programStore } from '../store/program.store'
import { cx } from '../ui/cx'
import { IconButton } from '../ui/IconButton'
import { currentInstallEnv, NOT_AN_EDIT, safariTabPlatform, type InstallPlatform } from './install'

const EDITED_KEY = 'gb:edited'
const DISMISSED_KEY = 'gb:install-nudge'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage blocked: the card simply shows again next time
  }
}

const isEdit = () => {
  const change = programStore.getState().lastChange
  return change !== null && !NOT_AN_EDIT.has(change.action)
}

/**
 * Card suggesting Add to Home Screen. Renders only in a Safari tab, after the user's first edit,
 * until dismissed. Placement is up to the host screen (the Plan screen, under the coverage card).
 */
export function InstallNudge({ className }: { className?: string }) {
  const [platform] = useState<InstallPlatform | null>(() => {
    const env = currentInstallEnv()
    return env ? safariTabPlatform(env) : null
  })
  const [edited, setEdited] = useState(() => read(EDITED_KEY) === '1' || isEdit())
  const [dismissed, setDismissed] = useState(() => read(DISMISSED_KEY) === 'dismissed')

  useEffect(() => {
    if (!platform || dismissed) return
    if (edited) {
      write(EDITED_KEY, '1')
      return
    }
    return programStore.subscribe(() => {
      if (isEdit()) setEdited(true)
    })
  }, [platform, edited, dismissed])

  if (!platform || !edited || dismissed) return null

  return (
    <aside
      aria-label="Add to Home Screen"
      className={cx('relative flex gap-3 rounded-xl bg-surface p-4 pr-12 print:hidden', className)}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
        <SquarePlus size={20} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 text-sm text-ink-2">
        <p className="text-base font-semibold text-ink">{platform === 'ios' ? 'Add to your Home Screen' : 'Add to your Dock'}</p>
        <p className="mt-1">
          Safari may clear data for sites you have not opened in 7 days. Installed, your programs stay put and the app
          works offline.
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-1 text-ink">
          {platform === 'ios' ? (
            <>
              Tap <Share size={16} strokeWidth={1.75} aria-label="Share" className="inline" />, then Add to Home Screen.
            </>
          ) : (
            <>In the menu bar choose File, then Add to Dock.</>
          )}
        </p>
      </div>
      <IconButton
        icon={X}
        label="Dismiss"
        size={36}
        className="absolute right-2 top-2"
        onClick={() => {
          write(DISMISSED_KEY, 'dismissed')
          setDismissed(true)
        }}
      />
    </aside>
  )
}
