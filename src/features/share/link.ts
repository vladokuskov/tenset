import { encode } from 'uqr'
import { ShareLinkError, encodeProgram } from '../../domain/codec'
import type { Program } from '../../domain/schema'

/**
 * Absolute /shared link; the program travels in the fragment, which browsers never send to a server.
 * Null when the program is too large for a link.
 */
export function shareUrl(program: Program, origin: string, base = '/'): string | null {
  try {
    return `${origin}${base.endsWith('/') ? base : `${base}/`}shared#${encodeProgram(program)}`
  } catch (e) {
    if (e instanceof ShareLinkError) return null
    throw e
  }
}

export type QrModules = { size: number; path: string; version: number }

/** QR modules as one SVG path in module units (no quiet zone). Null when the text is too long. */
export function qrModules(text: string): QrModules | null {
  let qr
  try {
    qr = encode(text, { ecc: 'L', boostEcc: true, border: 0 })
  } catch {
    return null
  }
  let path = ''
  qr.data.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (!row[x]) {
        x++
        continue
      }
      const start = x
      while (x < row.length && row[x]) x++
      path += `M${start} ${y}h${x - start}v1h${start - x}z`
    }
  })
  return { size: qr.size, path, version: qr.version }
}
