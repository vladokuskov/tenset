// Binary mask helpers (Uint8Array, 1 = set). Square structuring elements, separable.

function pass(src: Uint8Array, w: number, h: number, r: number, horizontal: boolean, isMax: boolean): Uint8Array {
  const out = new Uint8Array(w * h)
  const n = horizontal ? w : h
  const lines = horizontal ? h : w
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < n; i++) {
      let v = isMax ? 0 : 1
      for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) {
        const s = horizontal ? src[line * w + k] : src[k * w + line]
        if (isMax ? s : !s) {
          v = isMax ? 1 : 0
          break
        }
      }
      // outside the image counts as empty for erosion
      if (!isMax && (i - r < 0 || i + r > n - 1)) v = 0
      out[horizontal ? line * w + i : i * w + line] = v
    }
  }
  return out
}

export function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m.slice()
  return pass(pass(m, w, h, r, true, true), w, h, r, false, true)
}

export function erode(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m.slice()
  return pass(pass(m, w, h, r, true, false), w, h, r, false, false)
}

export function open(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return dilate(erode(m, w, h, r), w, h, r)
}

export function close(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return erode(dilate(m, w, h, r), w, h, r)
}

// 4-connected components. Returns per-pixel component id (0 = unset) and sizes (index = id).
export function components(m: Uint8Array, w: number, h: number): { ids: Int32Array; sizes: number[] } {
  const ids = new Int32Array(w * h)
  const sizes = [0]
  const stack: number[] = []
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || ids[s]) continue
    const id = sizes.length
    let size = 0
    ids[s] = id
    stack.push(s)
    while (stack.length) {
      const i = stack.pop()!
      size++
      const x = i % w
      const y = (i - x) / w
      if (x > 0 && m[i - 1] && !ids[i - 1]) { ids[i - 1] = id; stack.push(i - 1) }
      if (x < w - 1 && m[i + 1] && !ids[i + 1]) { ids[i + 1] = id; stack.push(i + 1) }
      if (y > 0 && m[i - w] && !ids[i - w]) { ids[i - w] = id; stack.push(i - w) }
      if (y < h - 1 && m[i + w] && !ids[i + w]) { ids[i + w] = id; stack.push(i + w) }
    }
    sizes.push(size)
  }
  return { ids, sizes }
}

// Fills background pockets not connected to the image border.
export function fillHoles(m: Uint8Array, w: number, h: number): Uint8Array {
  const inv = new Uint8Array(w * h)
  for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1
  const { ids } = components(inv, w, h)
  const outside = new Set<number>()
  for (let x = 0; x < w; x++) { outside.add(ids[x]); outside.add(ids[(h - 1) * w + x]) }
  for (let y = 0; y < h; y++) { outside.add(ids[y * w]); outside.add(ids[y * w + w - 1]) }
  const out = m.slice()
  for (let i = 0; i < m.length; i++) if (!m[i] && !outside.has(ids[i])) out[i] = 1
  return out
}

export type Crop = { x0: number; y0: number; w: number; h: number; data: Uint8Array }

// Crops to the set pixels' bounding box plus padding; null when the mask is empty.
export function crop(m: Uint8Array, w: number, h: number, pad: number): Crop | null {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (!m[row + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad)
  const cw = Math.min(w - 1, maxX + pad) - x0 + 1, ch = Math.min(h - 1, maxY + pad) - y0 + 1
  const data = new Uint8Array(cw * ch)
  for (let y = 0; y < ch; y++) data.set(m.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + cw), y * cw)
  return { x0, y0, w: cw, h: ch, data }
}
