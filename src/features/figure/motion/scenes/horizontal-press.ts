import type { SceneSpec } from './types.ts'

export const horizontalPress: SceneSpec = {
  camera: (params, mapView) => {
    // seated machine: near the front, so the near lever arm stays outside the chest
    if (params.implement === 'machine') return { az: -25, elev: 0.25 }
    // standing cable or band press: front three-quarter at chest height, as the standing cable fly, so the chest and
    // both arms read between the towers (or in front of the band's post)
    if (params.posture === 'standing') return { az: -35, elev: 0.22 }
    // decline: the raised legs hide the chest from past the feet, so from nearer the side and higher, where the chest,
    // the bar path and the leg hooks all read
    if (Number(params.benchAngle) < 0) return { az: -52, elev: 0.66 }
    // squeeze press: further round to the side, so the chest shows under the dumbbells pressed together over it
    if (params.squeeze) return { az: -60, elev: 0.45 }
    // lying: from past the feet on the lifter's right, raised, so the chest and both arms read between the plates
    // (from the side the near plate hides the near arm at the bottom); the close grip (triceps first) lower, so the
    // outside of the tucked near arm shows
    return mapView === 'B' ? { az: -25, elev: 0.4 } : { az: -25, elev: 0.55 }
  },
}
