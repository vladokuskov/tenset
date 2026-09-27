import type { CompactMotion } from '../../../motion/bake.ts'

// Baked loops shipped with the app: one lazy JSON chunk per exercise (baked/<id>-<slug>.json, written by
// bake.test.ts). The file list doubles as the motion manifest, so the catalog can decide what plays without
// loading three.js or the motion runtime.

export type MotionFile = {
  id: number
  /** <id>-<slug> */
  slug: string
  motion: CompactMotion
}

const files = import.meta.glob<MotionFile>('./baked/*.json', { import: 'default' })

const byId = new Map<number, () => Promise<MotionFile>>()
for (const [path, load] of Object.entries(files)) {
  const id = Number(/\/(\d+)-[^/]*\.json$/.exec(path)?.[1])
  if (id) byId.set(id, load)
}

/** exercise ids with a baked loop */
export const motionIds: readonly number[] = [...byId.keys()].sort((a, b) => a - b)

export function hasMotion(id: number | string): boolean {
  return typeof id === 'number' && byId.has(id)
}

export function loadMotionFile(id: number): Promise<MotionFile> {
  const load = byId.get(id)
  return load ? load() : Promise.reject(new Error(`no baked motion for exercise ${id}`))
}
