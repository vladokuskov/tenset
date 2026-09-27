import { useMemo } from 'react'
import { Quaternion, Vector3 } from 'three'
import { buildBarbell, buildEzBar, type BarbellParams, type EzBarParams } from './barbell'
import { buildAttachment, buildCableStack, type AttachmentKind, type CableStackParams } from './cable'
import type { PropBuild } from './kit'
import { buildLegPress, type LegPressParams } from './legpress'
import { PropModel } from './PropModel'
import { buildLatPulldown, type LatPulldownParams } from './pulldown'
import { buildAssistedPullup, buildPullupStation, type AssistedPullupParams, type PullupParams } from './pullup'
import { buildSquatRack, type SquatRackParams } from './rack'
import { buildSmith, type SmithParams } from './smith'

// three vectors and quaternions become tuples, so params compare by value and the builders get plain data
const plain = (_: string, v: unknown) => (v instanceof Vector3 || v instanceof Quaternion ? v.toArray() : v)

function useBuild<P, S>(build: (p: P) => PropBuild<S>, p: P) {
  const k = JSON.stringify(p ?? {}, plain)
  return useMemo(() => build(JSON.parse(k) as P), [build, k])
}

export function Barbell(p: BarbellParams) {
  return <PropModel pieces={useBuild(buildBarbell, p).pieces} />
}

export function EzBar(p: EzBarParams) {
  return <PropModel pieces={useBuild(buildEzBar, p).pieces} />
}

export function SquatRack(p: SquatRackParams) {
  return <PropModel pieces={useBuild(buildSquatRack, p).pieces} />
}

export function SmithMachine(p: SmithParams) {
  return <PropModel pieces={useBuild(buildSmith, p).pieces} />
}

export function LegPress(p: LegPressParams) {
  return <PropModel pieces={useBuild(buildLegPress, p).pieces} />
}

export function CableStack(p: CableStackParams) {
  return <PropModel pieces={useBuild(buildCableStack, p).pieces} />
}

const attachment = (p: { kind: AttachmentKind }) => buildAttachment(p.kind)

/** a cable attachment in its own frame (carabiner at the origin, handles towards -Y) */
export function CableAttachment({ kind }: { kind: AttachmentKind }) {
  return <PropModel pieces={useBuild(attachment, { kind }).pieces} />
}

export function PullupStation(p: PullupParams) {
  return <PropModel pieces={useBuild(buildPullupStation, p).pieces} />
}

export function AssistedPullup(p: AssistedPullupParams) {
  return <PropModel pieces={useBuild(buildAssistedPullup, p).pieces} />
}

export function LatPulldown(p: LatPulldownParams) {
  return <PropModel pieces={useBuild(buildLatPulldown, p).pieces} />
}
