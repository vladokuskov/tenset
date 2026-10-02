import type { ReactNode } from 'react'
import type { Exercise, Role } from '../../domain/schema'
import { deepHeads, getGroup, headGroup, headsOfGroup, visibleHeads } from '../../domain/taxonomy'
import { highlightColors } from '../figure/highlight'
import { Panel, Pill } from '../../ui'
import { cx } from '../../ui/cx'

const headName = new Map([...visibleHeads, ...deepHeads].map((h) => [h.id, h.name]))
const groupName = (id: string) => getGroup(id)?.name ?? id

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Panel as="section" className={cx('min-w-0 p-4', className)}>
      <h3 className="mb-3 text-sm font-semibold text-ink-2">{title}</h3>
      {children}
    </Panel>
  )
}

type HeadRow = { id: string; emphasis: number; implied: boolean; deep: boolean }

/** Every visible head of a listed group (omitted ones count 1) plus any deep head the record names. */
function headRows(exercise: Exercise, group: string): HeadRow[] {
  const explicit = exercise.heads ?? {}
  const visible = headsOfGroup(group).map((id) => ({ id, emphasis: explicit[id] ?? 1, implied: explicit[id] === undefined, deep: false }))
  const deep = Object.keys(explicit)
    .filter((id) => headGroup(id) === group && !visible.some((v) => v.id === id))
    .map((id) => ({ id, emphasis: explicit[id], implied: false, deep: true }))
  return [...visible, ...deep]
}

export function MappingCard({ exercise }: { exercise: Exercise }) {
  const order: Role[] = ['primary', 'secondary']
  const groups = order.flatMap((role) => Object.keys(exercise.groups).filter((g) => exercise.groups[g] === role).map((g) => ({ g, role })))
  const orphan = Object.keys(exercise.heads ?? {}).filter((h) => !exercise.groups[headGroup(h) ?? ''])
  return (
    <Card title="Muscle mapping">
      <ul className="space-y-3">
        {groups.map(({ g, role }) => (
          <li key={g}>
            <p className="flex items-center gap-2 font-medium">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: highlightColors[role] }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{groupName(g)}</span>
              <Pill size="sm" variant="soft">
                {role}
              </Pill>
            </p>
            <ul className="mt-1 space-y-0.5 pl-[1.125rem] text-sm">
              {headRows(exercise, g).map((h) => (
                <li key={h.id} className="flex justify-between gap-3">
                  <span className={cx('min-w-0 truncate', h.implied ? 'text-ink-3' : 'text-ink-2')}>
                    {headName.get(h.id) ?? h.id}
                    {h.deep && <span className="text-ink-3"> (deep)</span>}
                  </span>
                  <span className={cx('num shrink-0', h.implied ? 'text-ink-3' : 'font-medium text-ink')} title={h.implied ? 'Not listed in heads, counts as 1' : undefined}>
                    {h.emphasis}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {orphan.length > 0 && <p className="mt-3 text-sm font-medium text-ink">Heads outside the listed groups: {orphan.join(', ')}</p>}
      <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-3">Stabilizers</dt>
          <dd className="min-w-0 text-ink-2">{exercise.stabilizers.length ? exercise.stabilizers.map((g) => groupName(g)).join(', ') : 'None'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-3">Basis</dt>
          <dd className="min-w-0 break-words text-ink-2">
            {exercise.basis.join(', ') || 'None'} ({exercise.confidence} confidence)
          </dd>
        </div>
      </dl>
    </Card>
  )
}

export function CuesCard({ exercise }: { exercise: Exercise }) {
  return (
    <Card title="Cues">
      <ol className="space-y-2">
        {exercise.cues.map((c, i) => (
          <li key={c} className="flex gap-2.5">
            <span className="num w-4 shrink-0 text-right font-semibold text-ink-3" aria-hidden>
              {i + 1}
            </span>
            <span>{c}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

export function ParamsCard({ exercise }: { exercise: Exercise }) {
  const rows: [string, unknown][] = [
    ['template', exercise.media.template ?? 'none'],
    ...Object.entries(exercise.media.params),
  ]
  return (
    <Card title="Motion params">
      <dl className="divide-y divide-line font-mono text-[0.8125rem]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-1.5 first:pt-0">
            <dt className="shrink-0 text-ink-3">{k}</dt>
            <dd className="min-w-0 break-all text-right text-ink">{show(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-ink-3">
        {exercise.pattern.replace(/_/g, ' ')} · {exercise.laterality} · {exercise.equipment.join(', ') || 'bodyweight'}
      </p>
    </Card>
  )
}
