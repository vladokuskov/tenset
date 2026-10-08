import type { LayoutSource } from '../layout.ts'
import { barStackLayouts } from './back/bar-stack-layout.ts'
import { rowStationLayouts } from './back/layouts.ts'
import { rackLayouts } from './back/rack-layout.ts'
import { ropeLayouts } from './back/rope-layout.ts'

// F4 back: prop builders (Kit pieces in the props materials) with their sockets, and the layouts that draw them
// around a baked motion. Layout pieces are also the QA penetration gate's collision primitives (collision.ts).
export const layouts: LayoutSource = (b) => [...rowStationLayouts(b), ...rackLayouts(b), ...ropeLayouts(b), ...barStackLayouts(b)]
