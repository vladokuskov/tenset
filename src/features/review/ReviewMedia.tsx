import { ExternalLink, Film, Images } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import type { Exercise } from '../../domain/schema'
import { ExerciseMotion } from './LiveFigure'
import type { ReviewItem } from './types'

/** the detail page's media well, so the loop, the live figure and the sheet sit on the same colour */
const WELL = '#f6f6f4'

function Frame({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-1.5 flex h-8 items-center justify-between gap-2 px-1">
        <h3 className="text-sm font-semibold text-ink-2">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Missing({ icon: Icon, children }: { icon: typeof Film; children: ReactNode }) {
  return (
    <div className="flex aspect-[5/4] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-6 text-center text-sm text-ink-3">
      <Icon size={22} strokeWidth={1.5} aria-hidden />
      {children}
    </div>
  )
}

export function LoopPanel({ item }: { item: ReviewItem }) {
  return (
    <Frame title="Loop">
      {item.loop ? (
        <video
          key={item.loop}
          src={item.loop}
          poster={item.poster ?? undefined}
          autoPlay
          muted
          loop
          playsInline
          controls
          aria-label="Baked loop video"
          className="block aspect-[5/4] w-full rounded-xl object-contain"
          style={{ background: WELL }}
        />
      ) : (
        <Missing icon={Film}>
          {item.loopMissing ? (
            <span>
              The manifest names <code className="break-all">{item.loopMissing}</code> but the file is not in public/.
            </span>
          ) : (
            <span>No loop baked yet. The live figure plays the same motion.</span>
          )}
        </Missing>
      )}
    </Frame>
  )
}

export function LivePanel({ exercise }: { exercise: Exercise }) {
  return (
    <Frame title="Live figure">
      <ExerciseMotion key={exercise.id} exercise={exercise} />
    </Frame>
  )
}

export function SheetPanel({ item }: { item: ReviewItem }) {
  const zoom = useRef<HTMLDialogElement>(null)
  const alt = `Contact sheet for exercise ${item.id}: eight phases of the loop`
  return (
    <Frame
      title="Contact sheet"
      action={
        item.sheet && (
          <a href={item.sheet} target="_blank" rel="noreferrer" className="hit inline-flex items-center gap-1 text-sm font-medium text-accent">
            Open in a tab
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
          </a>
        )
      }
    >
      {item.sheet ? (
        <>
          <button
            type="button"
            onClick={() => zoom.current?.showModal()}
            aria-label="Zoom the contact sheet to full size"
            className="block w-full cursor-zoom-in overflow-hidden rounded-xl bg-white"
          >
            <img key={item.sheet} src={item.sheet} alt={alt} className="mx-auto block h-auto max-w-full" />
          </button>
          {/* full size, scroll to pan; a tap or Escape closes it, and the review shortcuts stay off while it is open */}
          <dialog
            ref={zoom}
            aria-label="Contact sheet at full size"
            onClick={() => zoom.current?.close()}
            onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}
            className="m-0 h-dvh max-h-none w-dvw max-w-none cursor-zoom-out overflow-auto bg-white p-0 backdrop:bg-black/60"
          >
            <img src={item.sheet} alt={alt} className="block h-auto w-auto max-w-none" />
            <button type="button" className="glass fixed right-3 top-3 flex h-11 items-center rounded-full px-4 text-sm font-medium text-ink shadow-thumb">
              Close
            </button>
          </dialog>
        </>
      ) : (
        <Missing icon={Images}>
          <span>
            No contact sheet yet. Baking the loop writes qa/out/loops/{item.file.replace(/\.json$/, '.png')}.
          </span>
        </Missing>
      )}
    </Frame>
  )
}
