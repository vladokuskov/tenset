// One opener per chain of sheets (menu -> share, entry -> move): focus returns to it when the last
// sheet of the chain closes, whatever order the dialogs close and open in.
let openCount = 0
let opener: HTMLElement | null = null
let closing = false

function currentOpener(): HTMLElement | null {
  const el = document.activeElement
  return el instanceof HTMLElement && el !== document.body && !el.closest('dialog') ? el : null
}

// When the opener is gone (the entry moved away, the page changed), land on the page title.
function restore(target: HTMLElement | null) {
  if (document.querySelector('dialog[open]')) return
  const el = target?.isConnected ? target : document.querySelector<HTMLElement>('main h1[tabindex]')
  el?.focus({ preventScroll: true })
}

export function sheetOpened() {
  if (openCount === 0 && !closing) opener = currentOpener()
  closing = false
  openCount++
}

export function sheetClosed() {
  openCount = Math.max(0, openCount - 1)
  if (openCount > 0) return
  closing = true
  // A chained sheet opens in the same commit or right after; wait for it before giving focus back.
  setTimeout(() => {
    if (!closing) return
    closing = false
    const target = opener
    opener = null
    restore(target)
  }, 0)
}
