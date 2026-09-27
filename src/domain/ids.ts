export type IdFactory = () => string

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

// crypto.randomUUID needs a secure context; getRandomValues works on plain http (LAN dev on a phone).
export function randomId(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

export function sequentialIds(prefix = 'e', start = 1): IdFactory {
  let n = start
  return () => `${prefix}${n++}`
}
