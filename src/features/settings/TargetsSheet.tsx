import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { groupName } from '../../data/localize'
import type { TargetMode, TargetPref } from '../../domain/schema'
import { TARGET_MAX, TARGET_MIN, type Targets } from '../../domain/targets'
import { groups as allGroups } from '../../domain/taxonomy'
import { common } from '../../i18n/common'
import { useLocale, useMessages } from '../../i18n/messages'
import { prefsStore, usePrefsStore } from '../../store/prefs.store'
import { Button, ChipGroup, Sheet, Stepper, cx } from '../../ui'
import { ChangeBar } from '../shared/ChangeBar'
import { settingsMessages } from './messages'
import { changedCount, customPref, modeOf, prefForMode, rangeText, TARGET_MODES } from './targetRanges'

const AREAS = ['upper', 'core', 'lower'] as const

type Status = { message: string; restore: Targets; group?: string }

/** Per-group weekly set range: research (Normal), shifted, skipped or the user's own. Undo instead of a confirm. */
export function TargetsSheet({ open, onClose, focus }: { open: boolean; onClose: () => void; focus?: string }) {
  const targets = usePrefsStore((s) => s.targets)
  const m = useMessages(settingsMessages)
  const locale = useLocale()
  const [status, setStatus] = useState<Status | null>(null)
  const [expanded, setExpanded] = useState<string | null>(focus ?? null)
  const [wasOpen, setWasOpen] = useState(open)
  const listRef = useRef<HTMLDivElement>(null)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStatus(null)
      setExpanded(focus ?? null)
    }
  }

  useEffect(() => {
    if (!open || !focus) return
    listRef.current?.querySelector(`[data-group="${focus}"]`)?.scrollIntoView({ block: 'center' })
  }, [open, focus])

  const apply = (group: string, pref: TargetPref | null) => {
    const before = prefsStore.getState().targets
    prefsStore.getState().setTarget(group, pref)
    const after = prefsStore.getState().targets
    // Changes to the same group in a row fold into one Undo.
    const restore = status?.group === group ? status.restore : before
    setStatus({ message: m.rangeSet(groupName(group, locale), rangeText(group, after, locale)), restore, group })
  }

  const resetAll = () => {
    const before = prefsStore.getState().targets
    prefsStore.setState({ targets: {} })
    setStatus({ message: m.rangesReset, restore: before })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={m.muscleRanges}
      description={m.targetsHint}
      footer={
        status ? (
          <ChangeBar
            message={status.message}
            onUndo={() => {
              prefsStore.setState({ targets: status.restore })
              setStatus(null)
            }}
          />
        ) : undefined
      }
    >
      <div ref={listRef}>
        {AREAS.map((area) => (
          <section key={area} className="mt-4 first:mt-0">
            <h4 className="text-xs font-medium text-ink-3">{m.area[area]}</h4>
            <ul className="mt-1 divide-y divide-line">
              {allGroups
                .filter((g) => g.banded && g.area === area)
                .map((g) => (
                  <TargetRow
                    key={g.id}
                    group={g.id}
                    targets={targets}
                    expanded={expanded === g.id}
                    onToggle={() => setExpanded((e) => (e === g.id ? null : g.id))}
                    onChange={(pref) => apply(g.id, pref)}
                  />
                ))}
            </ul>
          </section>
        ))}
      </div>
      {changedCount(targets) > 0 && (
        <Button className="mt-5" block onClick={resetAll}>
          {m.resetRanges}
        </Button>
      )}
    </Sheet>
  )
}

function TargetRow({
  group,
  targets,
  expanded,
  onToggle,
  onChange,
}: {
  group: string
  targets: Targets
  expanded: boolean
  onToggle: () => void
  onChange: (pref: TargetPref | null) => void
}) {
  const m = useMessages(settingsMessages)
  const c = useMessages(common)
  const locale = useLocale()
  const name = groupName(group, locale)
  const mode = modeOf(group, targets)
  const pref = targets[group]
  const panelId = `range-${group}`

  return (
    <li data-group={group}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{name}</span>
          <span className="num block truncate text-sm text-ink-2">{rangeText(group, targets, locale)}</span>
        </span>
        <span className={cx('shrink-0 text-sm', mode === 'normal' ? 'text-ink-3' : 'font-medium text-ink')}>
          {m.targetMode[mode]}
        </span>
        <ChevronDown
          size={18}
          className={cx('-mr-1 shrink-0 text-ink-3 transition-transform duration-200', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      {expanded && (
        <div id={panelId} className="pb-4">
          <ChipGroup<TargetMode>
            label={m.rangeFor(name)}
            options={TARGET_MODES.map((v) => ({ value: v, label: m.targetMode[v] }))}
            value={mode}
            onChange={(v) => v && onChange(prefForMode(v, group, targets))}
          />
          {pref?.mode === 'custom' && (
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
              <div className="flex items-center gap-3 text-sm text-ink-2">
                <span aria-hidden>{m.rangeFrom}</span>
                <Stepper
                  label={m.minFor(name)}
                  value={pref.min}
                  min={TARGET_MIN}
                  max={pref.max - 1}
                  valueText={c.sets}
                  onChange={(v) => onChange(customPref(v, pref.max))}
                />
              </div>
              <div className="flex items-center gap-3 text-sm text-ink-2">
                <span aria-hidden>{m.rangeTo}</span>
                <Stepper
                  label={m.maxFor(name)}
                  value={pref.max}
                  min={pref.min + 1}
                  max={TARGET_MAX}
                  valueText={c.sets}
                  onChange={(v) => onChange(customPref(pref.min, v))}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  )
}
