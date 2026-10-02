import { useMemo, type CSSProperties } from 'react'
import { equipmentName } from '../../data/localize'
import type { Locale } from '../../i18n/locale'
import { useLocale } from '../../i18n/messages'
import { cx } from '../../ui/cx'
import { cropViewBox, MAP_HEIGHT, MAP_WIDTH, regionBounds, useAnatomy, type AnatomyView } from '../bodymap/anatomy'
import { AnatomyFigure, type FigureVars } from '../bodymap/AnatomyFigure'
import { tintVars } from '../bodymap/fills'
import { cardView, equipmentGlyph, isCatalogExercise, showsMotion, type CardExercise } from './media'
import { catalogMessages } from './messages'
import { posterUrl } from './posters'
import { useRoles } from './useRoles'

export type ExerciseCardMediaProps = {
  exercise: CardExercise
  /** sm: 48px row poster. md: grid card, fills its column. lg: detail hero, both views. */
  size: 'sm' | 'md' | 'lg'
  className?: string
}

// Implements first; supports (benches, racks, steps) only name the card when nothing else does.
const IMPLEMENT_ORDER = ['barbell', 'ez_bar', 'dumbbell', 'cable', 'smith', 'plate']
const SUPPORTS = new Set(['flat_bench', 'adjustable_bench', 'rack', 'step'])
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

type Crop = { view: AnatomyView; viewBox: string }

function useCrop(view: AnatomyView, kind: 'full' | 'groups', groups: string, aspect: number, minHeight: number, pad: number): Crop | null {
  const doc = useAnatomy(view, kind)
  return useMemo(() => {
    if (!doc) return null
    const wanted = groups.split(',')
    const b =
      regionBounds(doc, (r) => !!r.group && wanted.includes(r.group)) ??
      regionBounds(doc, (r) => r.group === 'abs' || r.group === 'lower_back')
    return b ? { view, viewBox: cropViewBox(b, aspect, minHeight, pad) } : null
  }, [doc, groups, view, aspect, minHeight, pad])
}

// Detail hero: both views share one horizontal band around the tinted muscles, full figure width.
function useBand(groups: string, minHeight: number): string | null {
  const front = useAnatomy('front', 'full')
  const back = useAnatomy('back', 'full')
  return useMemo(() => {
    if (!front || !back) return null
    const wanted = groups.split(',')
    const match = (r: { group?: string }) => !!r.group && wanted.includes(r.group)
    const bs = [regionBounds(front, match), regionBounds(back, match)].filter((b) => b !== null)
    if (!bs.length) return `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`
    const y0 = Math.min(...bs.map((b) => b.y0))
    const y1 = Math.max(...bs.map((b) => b.y1))
    const h = Math.min(MAP_HEIGHT, Math.max(minHeight, (y1 - y0) * 1.3))
    const y = Math.max(0, Math.min(MAP_HEIGHT - h, (y0 + y1) / 2 - h / 2))
    return `0 ${y.toFixed(1)} ${MAP_WIDTH} ${h.toFixed(1)}`
  }, [front, back, groups, minHeight])
}

/**
 * List and grid media: the baked poster when the exercise may show its motion (see showsMotion), otherwise the M1
 * card, the exercise's map view with primary muscles in the strong tint and secondary ones in the light tint, plus
 * an equipment glyph. The detail hero (lg) always uses the card; ExerciseMedia swaps in the live figure there.
 */
export function ExerciseCardMedia(props: ExerciseCardMediaProps) {
  const poster = props.size !== 'lg' && showsMotion(props.exercise) ? posterUrl(props.exercise.id) : null
  return poster ? <PosterMedia {...props} src={poster} /> : <MapCardMedia {...props} />
}

function PosterMedia({ exercise, size, className, src }: ExerciseCardMediaProps & { src: string }) {
  const locale = useLocale()
  const { icon: Glyph } = equipmentGlyph(exercise.equipment)
  const label = equipmentLabel(exercise.equipment, locale)
  if (size === 'sm') {
    return (
      <div className={cx('relative size-12 shrink-0 overflow-hidden rounded-md bg-white', className)} aria-hidden>
        <img src={src} alt="" width={480} height={480} loading="lazy" decoding="async" className="block size-full object-cover" />
      </div>
    )
  }
  return (
    <div className={cx('relative aspect-[4/5] overflow-hidden rounded-lg bg-white', className)}>
      <img
        src={src}
        alt={catalogMessages[locale].posterAlt(exercise.name, label)}
        width={480}
        height={480}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 block size-full object-contain"
      />
      <span className="glass absolute bottom-2 left-2 flex h-6 max-w-[calc(100%-1rem)] items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2 text-[0.6875rem] text-ink-2 shadow-thumb">
        <Glyph size={12} strokeWidth={2} aria-hidden className="shrink-0" />
        <span className="truncate font-medium">{label}</span>
      </span>
    </div>
  )
}

function MapCardMedia({ exercise, size, className }: ExerciseCardMediaProps) {
  const roles = useRoles(exercise)
  const heads = isCatalogExercise(exercise) ? exercise.heads : undefined
  const view = cardView(exercise, roles)
  const locale = useLocale()
  const { icon: Glyph } = equipmentGlyph(exercise.equipment)
  const label = equipmentLabel(exercise.equipment, locale)
  const primaries = Object.keys(roles).filter((g) => roles[g] === 'primary').join(',')
  const tinted = Object.keys(roles).join(',')
  const vars = useMemo(
    () => ({ ...CARD_VARS, ...tintVars({ groups: roles, heads: size === 'sm' ? undefined : heads }) }),
    [roles, heads, size],
  )

  const smCrop = useCrop(view, 'groups', primaries || tinted, 1, 560, 0.16)
  const mdCrop = useCrop(view, 'full', tinted, 4 / 5, 1040, 0.1)
  const band = useBand(tinted, 1300)

  if (size === 'sm') {
    return (
      <div className={cx('relative size-12 shrink-0 overflow-hidden rounded-md bg-surface-2', className)} aria-hidden>
        {smCrop && <AnatomyFigure view={view} kind="groups" viewBox={smCrop.viewBox} vars={vars} className="block size-full" />}
      </div>
    )
  }

  const lineVars = { '--gb-line': 'var(--color-raised)', '--gb-line-w': size === 'lg' ? '0.75px' : '0.6px' } as CSSProperties
  const name = catalogMessages[locale].cardAlt(exercise.name, label)
  return (
    <div
      role="img"
      aria-label={name}
      className={cx(
        'relative overflow-hidden bg-surface-2',
        size === 'lg' ? 'aspect-[5/4] rounded-xl' : 'aspect-[4/5] rounded-lg',
        className,
      )}
      style={lineVars}
    >
      {size === 'lg' ? (
        band && (
          <div className="absolute inset-x-[4%] bottom-10 top-4 flex justify-center gap-[4%]">
            {(['front', 'back'] as const).map((v) => (
              <AnatomyFigure key={v} view={v} kind="full" viewBox={band} vars={vars} className="block h-full min-w-0 flex-1" style={FADE} />
            ))}
          </div>
        )
      ) : (
        mdCrop && (
          <AnatomyFigure view={view} kind="full" viewBox={mdCrop.viewBox} vars={vars} className="absolute inset-0 block size-full" style={FADE} />
        )
      )}
      <span
        className={cx(
          'glass absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2 text-ink-2 shadow-thumb',
          size === 'lg' ? 'h-7 text-xs' : 'h-6 text-[0.6875rem]',
        )}
      >
        <Glyph size={size === 'lg' ? 14 : 12} strokeWidth={2} aria-hidden className="shrink-0" />
        <span className="truncate font-medium">{label}</span>
      </span>
    </div>
  )
}
