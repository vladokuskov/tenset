import { BAR_PAD } from '../../../../../motion/implements/hinge.ts'
import { Kit, type Piece } from '../../kit.ts'

/** foam sleeve round the middle of a bar, in the bar's frame (along X) */
export function buildBarPad(): Piece[] {
  const { r, half } = BAR_PAD
  const kit = new Kit()
  kit.rod([-half, 0, 0], [half, 0, 0], r, 'pad', 32)
  for (const s of [-1, 1]) kit.rod([s * (half - 0.004), 0, 0], [s * (half + 0.002), 0, 0], r - 0.004, 'rubber', 32)
  return kit.pieces
}
