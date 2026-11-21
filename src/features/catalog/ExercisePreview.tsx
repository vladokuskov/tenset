import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { equipmentName, groupName, loadExerciseText } from '../../data/localize'
import { loopUrl, posterUrl } from '../../data/posters'
import type { Exercise, Role } from '../../domain/schema'
import type { Locale } from '../../i18n/locale'
import { useLocale } from '../../i18n/messages'
import { IconButton, Sheet } from '../../ui'
import { movementLabel } from '../../ui/movement'
import { groupOf } from '../shared/exercise'
import { MapMedia } from './ExerciseCardMedia'
import { reducedMotion, showsMotion } from './media'
import { catalogMessages } from './messages'

const namesWith = (groups: Readonly<Record<string, Role>>, role: Role, locale: Locale) =>
  Object.entries(groups)
    .filter(([, r]) => r === role)
    .map(([g]) => groupName(g, locale))
    .join(', ')

/** Large loop with play/pause and half speed, then muscles, equipment and cues. Reduced motion starts paused. */
function Player({ exercise, loop, poster }: { exercise: Exercise; loop: string; poster: string }) {
  const m = catalogMessages[useLocale()]
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(() => !reducedMotion())
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.playbackRate = slow ? 0.5 : 1
    if (playing) void v.play().catch(() => setPlaying(false))
    else v.pause()
  }, [playing, slow])

  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-xl bg-white">
        <video
          ref={ref}
          src={loop}
          poster={poster}
          aria-label={m.loopAlt(exercise.name)}
          muted
          loop
          playsInline
          disablePictureInPicture
          preload="auto"
          onClick={() => setPlaying(!playing)}
          className="absolute inset-0 block size-full cursor-pointer object-contain"
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <IconButton icon={playing ? Pause : Play} label={playing ? m.pause : m.play} variant="tonal" onClick={() => setPlaying(!playing)} />
        <button
          type="button"
          aria-pressed={slow}
          aria-label={m.halfSpeed}
          onClick={() => setSlow(!slow)}
          className="hit num h-9 rounded-full bg-surface-2 px-3 text-sm font-medium text-ink aria-pressed:bg-ink aria-pressed:text-on-ink"
        >
          0.5×
        </button>
      </div>
    </div>
  )
}

export function ExercisePreview({ exercise, open, onClose }: { exercise: Exercise | undefined; open: boolean; onClose: () => void }) {
  const locale = useLocale()
  const m = catalogMessages[locale]
  useEffect(() => {
    if (open) void loadExerciseText(locale).catch(() => undefined)
  }, [open, locale])

  const loop = exercise && showsMotion(exercise) ? loopUrl(exercise.id) : null
  const poster = exercise ? posterUrl(exercise.id) : null
  const primary = exercise ? namesWith(exercise.groups, 'primary', locale) : ''
  const secondary = exercise ? namesWith(exercise.groups, 'secondary', locale) : ''

  return (
    <Sheet
      open={open && Boolean(exercise)}
      onClose={onClose}
      title={exercise?.name ?? ''}
      description={exercise ? `${movementLabel(groupOf(exercise), locale)} · ${primary || m.noMuscles}` : undefined}
    >
      {exercise && (
        <>
          {loop && poster ? (
            <Player key={exercise.id} exercise={exercise} loop={loop} poster={poster} />
          ) : (
            <MapMedia exercise={exercise} aspect={1} />
          )}

          <dl className="mt-5 divide-y divide-line rounded-xl bg-surface px-4">
            <div className="flex justify-between gap-4 py-3">
              <dt className="shrink-0 text-ink-2">{m.primary}</dt>
              <dd className="min-w-0 text-right">{primary || m.noMuscles}</dd>
            </div>
            {secondary && (
              <div className="flex justify-between gap-4 py-3">
                <dt className="shrink-0 text-ink-2">{m.secondary}</dt>
                <dd className="min-w-0 text-right">{secondary}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 py-3">
              <dt className="shrink-0 text-ink-2">{m.equipment}</dt>
              <dd className="min-w-0 text-right">
                {exercise.equipment.length ? exercise.equipment.map((e) => equipmentName(e, locale)).join(', ') : m.glyph.bodyweight}
              </dd>
            </div>
          </dl>

          {exercise.cues.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-2 px-1 text-sm font-semibold text-ink-2">{m.howTo}</h3>
              <ol className="divide-y divide-line rounded-xl bg-surface px-4">
                {exercise.cues.map((c, i) => (
                  <li key={c} className="flex gap-3 py-3">
                    <span className="num w-5 shrink-0 text-right font-semibold text-ink-3" aria-hidden>
                      {i + 1}
                    </span>
                    <span>{c}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </Sheet>
  )
}
