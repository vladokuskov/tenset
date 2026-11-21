import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { equipmentName } from '../../data/localize'
import { loopUrl, posterUrl } from '../../data/posters'
import type { MovementKey } from '../../domain/movement'
import type { Exercise } from '../../domain/schema'
import type { Locale } from '../../i18n/locale'
import { useLocale } from '../../i18n/messages'
import { cx } from '../../ui/cx'
import { mvBorder } from '../../ui/movement'
import { AnatomyFigure, cropViewBox, regionBounds, tintVars, useAnatomy, type FigureVars } from '../bodymap'
import { groupOf } from '../shared/exercise'
import { cardView, equipmentGlyph, reducedMotion, showsMotion } from './media'
import { catalogMessages } from './messages'

// Implements first; supports (benches, racks, steps) only name the card when nothing else does.
const IMPLEMENT_ORDER = ['landmine', 'trap_bar', 'barbell', 'ez_bar', 'dumbbell', 'kettlebell', 'cable', 'band', 'smith', 'plate']
const SUPPORTS = new Set(['flat_bench', 'adjustable_bench', 'rack', 'step', 'preacher_bench'])
// Crops end mid-body; a short fade makes the cut read as intentional.
const FADE: CSSProperties = {
  maskImage: 'linear-gradient(to bottom, #000 80%, transparent 99%)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 80%, transparent 99%)',
}

function equipmentLabel(items: readonly string[], locale: Locale): string {
  const m = catalogMessages[locale]
  if (!items.length) return m.glyph.bodyweight
  const pick =
    IMPLEMENT_ORDER.find((id) => items.includes(id)) ?? items.find((id) => !SUPPORTS.has(id)) ?? items[0]
  return m.equipmentShort[pick] ?? equipmentName(pick, locale)
}

// Card look: pale silhouette, untinted muscles a step darker, hairline separations; tints come from tintVars.
const REST = 'color-mix(in oklab, var(--color-vol-none) 88%, var(--color-raised))'
const CARD_VARS: FigureVars = {
  '--gb-skin': 'color-mix(in oklab, var(--color-map-skin) 45%, var(--color-raised))',
  '--gb-rest': REST,
  '--gb-untracked': REST,
}


/** True while the element is on screen (with a small margin so loops start just before they scroll in). */
function useInView(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: '100px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return inView
}

/**
 * Card media: the baked loop while on screen (poster otherwise, and always under reduced motion) when the exercise
 * may show its motion (see showsMotion), else a body map crop with primary muscles in the strong tint.
 */
export function ExerciseCardMedia({ exercise, className }: { exercise: Exercise; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const poster = showsMotion(exercise) ? posterUrl(exercise.id) : null
  return poster && poster !== failed ? (
    <MotionMedia exercise={exercise} className={className} poster={poster} onError={() => setFailed(poster)} />
  ) : (
    <MapMedia exercise={exercise} className={className} />
  )
}

function EquipmentTag({ exercise }: { exercise: Exercise }) {
  const locale = useLocale()
  const { icon: Glyph } = equipmentGlyph(exercise.equipment, locale)
  return (
    <span className="glass absolute bottom-2 left-2 flex h-6 max-w-[calc(100%-1rem)] items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2 text-[0.6875rem] text-ink-2 shadow-thumb">
      <Glyph size={12} strokeWidth={2} aria-hidden className="shrink-0" />
      <span className="truncate font-medium">{equipmentLabel(exercise.equipment, locale)}</span>
    </span>
  )
}

function MotionMedia({ exercise, className, poster, onError }: { exercise: Exercise; className?: string; poster: string; onError: () => void }) {
  const locale = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const [reduced] = useState(reducedMotion)
  const loop = reduced ? null : loopUrl(exercise.id)
  const alt = catalogMessages[locale].posterAlt(exercise.name, equipmentLabel(exercise.equipment, locale))
  return (
    <div ref={ref} className={cx('relative aspect-[4/5] overflow-hidden rounded-xl bg-white', className)}>
      <img
        src={poster}
        alt={alt}
        width={480}
        height={480}
        loading="lazy"
        decoding="async"
        onError={onError}
        className="absolute inset-0 block size-full object-contain"
      />
      {loop && inView && (
        <video
          src={loop}
          poster={poster}
          aria-hidden
          muted
          loop
          autoPlay
          playsInline
          disablePictureInPicture
          preload="auto"
          className="absolute inset-0 block size-full object-contain"
        />
      )}
      <EquipmentTag exercise={exercise} />
      <GroupRing group={groupOf(exercise)} />
    </div>
  )
}

/** 3px group-colored ring drawn over the tile edge, so the white tile keeps its footprint and the image is never tinted. */
function GroupRing({ group }: { group: MovementKey }) {
  return <span aria-hidden className={cx('pointer-events-none absolute inset-0 rounded-[inherit] border-3', mvBorder[group])} />
}

/** Body map crop with the worked muscles tinted; `aspect` is width / height. */
export function MapMedia({ exercise, className, aspect = 4 / 5 }: { exercise: Exercise; className?: string; aspect?: number }) {
  const roles = exercise.groups
  const view = cardView(exercise)
  const locale = useLocale()
  const tinted = Object.keys(roles).join(',')
  const vars = useMemo(() => ({ ...CARD_VARS, ...tintVars({ groups: roles, heads: exercise.heads }) }), [roles, exercise.heads])
  const doc = useAnatomy(view, 'full')
  const viewBox = useMemo(() => {
    if (!doc) return null
    const wanted = tinted.split(',')
    const b =
      regionBounds(doc, (r) => !!r.group && wanted.includes(r.group)) ??
      regionBounds(doc, (r) => r.group === 'abs' || r.group === 'lower_back')
    return b ? cropViewBox(b, aspect, 1040, 0.1) : null
  }, [doc, tinted, aspect])

  return (
    <div
      role="img"
      aria-label={catalogMessages[locale].cardAlt(exercise.name, equipmentLabel(exercise.equipment, locale))}
      className={cx('relative overflow-hidden rounded-xl bg-raised', className)}
      style={{ aspectRatio: aspect, '--gb-line': 'var(--color-raised)', '--gb-line-w': '0.6px' } as CSSProperties}
    >
      {viewBox && (
        <AnatomyFigure view={view} kind="full" viewBox={viewBox} vars={vars} className="absolute inset-0 block size-full" style={FADE} />
      )}
      <EquipmentTag exercise={exercise} />
      <GroupRing group={groupOf(exercise)} />
    </div>
  )
}
