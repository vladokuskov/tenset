import { Check, Copy, Share } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useActiveProgram } from '../../store/program.store'
import { Button } from '../../ui/Button'
import { Sheet } from '../../ui/Sheet'
import { showToast } from '../../ui/toast'
import { qrModules, shareUrl } from './link'

export type ShareDialogProps = { open: boolean; onClose: () => void }

// Dense codes are hard to scan from a screen; the link still works.
const DENSE_VERSION = 20

async function copyText(text: string, fallback: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    if (!fallback) return false
    fallback.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    }
  }
}

/** Share the active program as a /shared link and QR code. Mount it in the Plan overflow. */
export function ShareDialog({ open, onClose }: ShareDialogProps) {
  const program = useActiveProgram()
  const inputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
  const url = useMemo(
    () => (program && open ? shareUrl(program, window.location.origin, import.meta.env.BASE_URL) : ''),
    [program, open],
  )
  const qr = useMemo(() => (url ? qrModules(url) : null), [url])
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    if (await copyText(url, inputRef.current)) {
      setCopied(true)
      showToast({ message: 'Link copied' })
    } else {
      showToast({ message: 'Could not copy. Select the link and copy it manually.' })
    }
  }

  const share = async () => {
    try {
      await navigator.share({ title: program?.name, text: `${program?.name}: a weekly gym program`, url })
    } catch {
      // cancelled or unavailable; the copy button remains
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Share program"
      description={program ? program.name : undefined}
      desktop="center"
    >
      {!program ? (
        <p className="text-ink-2">There is no program to share yet.</p>
      ) : (
        <>
          <div className="flex justify-center">
            {qr ? (
              <figure className="rounded-xl bg-white p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
                <svg
                  viewBox={`0 0 ${qr.size} ${qr.size}`}
                  width={208}
                  height={208}
                  shapeRendering="crispEdges"
                  role="img"
                  aria-label="QR code for the share link"
                  data-qr-version={qr.version}
                >
                  <path d={qr.path} fill="#000" />
                </svg>
              </figure>
            ) : (
              <p className="rounded-xl bg-surface-2 px-4 py-6 text-center text-sm text-ink-2">
                This program is too long for a QR code. The link below still works.
              </p>
            )}
          </div>
          {qr && qr.version > DENSE_VERSION && (
            <p className="mt-2 text-center text-sm text-ink-2">Long program, so the code is dense. Hold the camera close.</p>
          )}

          <label className="mt-5 block">
            <span className="sr-only">Share link</span>
            <input
              ref={inputRef}
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="h-11 w-full truncate rounded-md border border-line-strong bg-surface px-3 text-sm text-ink-2"
            />
          </label>
          <div className="mt-3 flex gap-3">
            <Button variant="primary" className="flex-1" icon={copied ? Check : Copy} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {canShare && (
              <Button variant="secondary" className="flex-1" icon={Share} onClick={() => void share()}>
                Share
              </Button>
            )}
          </div>

          <ul className="mt-5 list-disc space-y-1.5 pl-5 text-sm text-ink-2 marker:text-ink-3">
            <li>
              Numbers follow the recipient's settings: their goal, counting mode and any "Edit how this counts" changes.
            </li>
            <li>Opening the link shows a preview. It never changes the recipient's programs.</li>
            <li>The program lives in the link itself. Nothing is uploaded.</li>
          </ul>
        </>
      )}
    </Sheet>
  )
}
