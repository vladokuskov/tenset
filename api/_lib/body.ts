/** Largest request body the API reads; a full program is well under it. */
export const BODY_MAX = 128 * 1024

export class BodyTooLarge extends Error {
  constructor() {
    super(`request body is over ${BODY_MAX} bytes`)
  }
}

/** The body as text, refusing anything over BODY_MAX before reading it all. */
export async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length')) > BODY_MAX) throw new BodyTooLarge()
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > BODY_MAX) {
      await reader.cancel()
      throw new BodyTooLarge()
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}
