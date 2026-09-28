import type { Baked } from '../../../motion/bake.ts'
import { sceneFor } from '../motion/scenes/index.ts'
import { familyLayouts } from './families/index.ts'
import type { MachineLayout } from './layout.ts'

/** equipment the family prop modules and the template's scene module draw around a baked motion */
export function extensionLayouts(b: Baked): MachineLayout[] {
  const out = [...familyLayouts(b), ...(sceneFor(b.template).layouts?.(b) ?? [])]
  const keys = new Set<string>()
  for (const l of out) {
    if (keys.has(l.key)) throw new Error(`${b.template}: two props share the key ${l.key}`)
    keys.add(l.key)
  }
  return out
}
