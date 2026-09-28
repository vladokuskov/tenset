import type { SceneSpec } from './types.ts'

export const pushUp: SceneSpec = {
  // front three-quarter, lower than the default: the chest faces the floor, so only a low camera sees it under the
  // plank, and the body still reads along its length
  camera: () => ({ az: -45, elev: 0.12 }),
  grip: (ctx) => (ctx.spec.kind === 'floor_contact' ? 'push-up-palm' : undefined),
}
