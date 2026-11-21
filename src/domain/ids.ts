export type IdFactory = () => string

export function sequentialIds(prefix = 'e', start = 1): IdFactory {
  let n = start
  return () => `${prefix}${n++}`
}
