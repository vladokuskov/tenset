import { CalendarPlus, Share } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { formatDayList } from '../../app/days'
import { useCatalog } from '../../app/useCatalog'
import { useWeek } from '../../app/useWeek'
import { useLocale, useMessages } from '../../i18n/messages'
import { Button, Sheet } from '../../ui'
import { canShareFiles, download, shareOrDownload } from './files'
import { buildIcs, DEFAULT_TIME, ICS_FILE_NAME, planEvents } from './ics'
import { exportMessages } from './messages'

const field = 'h-11 w-full rounded-md bg-surface-2 px-3 text-base text-ink'

/** Weekly calendar events for the active program as an .ics file. */
export function CalendarSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const view = useWeek()
  const { catalog } = useCatalog()
  const locale = useLocale()
  const m = useMessages(exportMessages)
  const [time, setTime] = useState(DEFAULT_TIME)
  const timeId = useId()

  const events = useMemo(
    () => (view ? planEvents(view.program, view.days, catalog, locale, view.prefs.weekStart) : []),
    [view, catalog, locale],
  )
  const makeFile = () =>
    new File([buildIcs({ programId: view?.program.id ?? 'program', events, time: time || DEFAULT_TIME })], ICS_FILE_NAME, {
      type: 'text/calendar',
    })
  const share = useMemo(() => canShareFiles(new File([''], ICS_FILE_NAME, { type: 'text/calendar' })), [])
  const none = events.length === 0

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={m.calendar.title}
      description={m.calendar.text}
      desktop="center"
      footer={
        <div className="flex gap-3">
          <Button variant="primary" className="flex-1" icon={CalendarPlus} disabled={none} onClick={() => download(makeFile())}>
            {m.calendar.download}
          </Button>
          {share && (
            <Button
              variant="secondary"
              className="flex-1"
              icon={Share}
              disabled={none}
              onClick={() => void shareOrDownload(makeFile(), m.calendar.shareTitle)}
            >
              {m.calendar.share}
            </Button>
          )}
        </div>
      }
    >
      <label htmlFor={timeId} className="block text-sm font-semibold">
        {m.calendar.time}
      </label>
      <input
        id={timeId}
        type="time"
        value={time}
        step={300}
        onChange={(e) => setTime(e.target.value)}
        className={`${field} mt-1.5`}
      />
      <p role="status" className="mt-4 text-sm text-ink-2">
        {none
          ? m.calendar.none
          : m.calendar.events(
              events.length,
              formatDayList(
                events.map((e) => e.day),
                view?.prefs.weekStart,
                'short',
                locale,
              ),
            )}
      </p>
    </Sheet>
  )
}
