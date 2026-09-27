import { REVIEW_API, type DecisionRequest, type DecisionResponse, type QueueResponse, type RestoreRequest } from './types'

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${REVIEW_API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !data) throw new Error(data?.error ?? `review endpoint answered ${res.status}`)
  return data
}

export const fetchQueue = () => call<QueueResponse>('/queue')
export const postDecision = (req: DecisionRequest) => call<DecisionResponse>('/decision', req)
export const postRestore = (req: RestoreRequest) => call<DecisionResponse>('/restore', req)
