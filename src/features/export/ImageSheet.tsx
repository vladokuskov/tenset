import { Download, Share } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DayIndex } from '../../app/days'
import { useCatalog } from '../../app/useCatalog'
import { useWeek } from '../../app/useWeek'
import { groupShade } from '../../app/volumeScale'
import { useLocale, useMessages } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { Button, Sheet } from '../../ui'
import { useAnatomy } from '../bodymap/anatomy'
import { canShareFiles, download, shareOrDownload } from './files'
import { canvasMeasure, layoutDay, layoutWeek, renderImage, resolvePalette, type Measure, type ShadeFn } from './image'
import { dayImageContent, dayImageName, WEEK_IMAGE_NAME, weekImageContent } from './imageContent'
import { exportMessages } from './messages'

type Result = { file: File; url: string } | 'error' | null

export type ImageSheetProps = {
  open: boolean
  onClose: () => void
  /** A day draws that session; omitted draws the week. */
  day?: DayIndex
}

/** PNG of a day or the week with a preview, then share or download. Mounts on first open, so the map art loads only then. */
export function ImageSheet(props: ImageSheetProps) {
  const [used, setUsed] = useState(props.open)
  if (props.open && !used) setUsed(true)
  return used ? <ImageSheetBody {...props} /> : null
}

function ImageSheetBody({ open, onClose, day }: ImageSheetProps) {
  const view = useWeek()
  const { catalog } = useCatalog()
  const locale = useLocale()
  const m = useMessages(exportMessages)
  const targets = usePrefsStore((s) => s.targets)
  const front = useAnatomy('front', 'full')
  const back = useAnatomy('back', 'full')
  const [result, setResult] = useState<Result>(null)

  const content = useMemo(() => {
    if (!view) return null
    if (day === undefined) {
      const week = weekImageContent(view, locale)
      return { title: week.title, groups: view.week.weekly, file: WEEK_IMAGE_NAME, layout: (mm: Measure) => layoutWeek(week, mm) }
    }
    const c = dayImageContent(view, day, catalog, locale)
    return {
      title: c.title,
      groups: Object.fromEntries(Object.entries(view.week.daily).map(([g, d]) => [g, d[day]])),
      file: dayImageName(day),
      layout: (mm: Measure) => layoutDay(c, mm),
    }
  }, [view, day, catalog, locale])

  useEffect(() => {
    if (!open || !content || !front || !back) return
    let cancelled = false
    let url: string | null = null
    const shade: ShadeFn = (g, sets, scale) => groupShade(g, sets, scale, targets)
    // Wait a frame so the sheet opens before the canvas work.
    const frame = requestAnimationFrame(() => {
      try {
        const { measure, family } = canvasMeasure()
        const layout = content.layout(measure)
        renderImage(
          { layout, docs: { front, back }, groups: content.groups, shade, palette: resolvePalette(), fileName: content.file },
          family,
        ).then(
          (file) => {
            if (cancelled) return
            url = URL.createObjectURL(file)
            setResult({ file, url })
          },
          () => !cancelled && setResult('error'),
        )
      } catch {
        setResult('error')
      }
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      if (url) URL.revokeObjectURL(url)
      setResult(null)
    }
  }, [open, content, front, back, targets])

  const title = day === undefined ? m.image.weekTitle : m.image.dayTitle
  const ready = result && result !== 'error' ? result : null
  const share = ready ? canShareFiles(ready.file) : false

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      desktop="center"
      footer={
        <div className="flex gap-3">
          {share && (
            <Button
              variant="primary"
              className="flex-1"
              icon={Share}
              onClick={() => ready && void shareOrDownload(ready.file, content?.title ?? title)}
            >
              {m.image.share}
            </Button>
          )}
          <Button
            variant={share ? 'secondary' : 'primary'}
            className="flex-1"
            icon={Download}
            disabled={!ready}
            onClick={() => ready && download(ready.file)}
          >
            {m.image.download}
          </Button>
        </div>
      }
    >
      {ready ? (
        <img
          src={ready.url}
          alt={m.image.preview(content?.title ?? title)}
          className="mx-auto block max-h-[60dvh] w-auto max-w-full rounded-lg border border-line"
        />
      ) : (
        <p role="status" className="flex min-h-48 items-center justify-center rounded-lg bg-surface-2 px-4 text-center text-sm text-ink-2">
          {result === 'error' ? m.image.failed : m.image.making}
        </p>
      )}
    </Sheet>
  )
}
