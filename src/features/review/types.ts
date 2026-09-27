// Shared by the review page and the Vite dev middleware (devServer.ts). Dev only, never in a production build.

export const REVIEW_API = '/__review'

export type QaStatus = 'pending' | 'approved' | 'rejected'
export type MediaStatus = 'card' | 'still' | 'loop'
export type Decision = 'approved' | 'rejected'

/** the only record fields the review writes */
export type ReviewFields = {
  motion: QaStatus
  note?: string
  mediaStatus: MediaStatus
}

export type ReviewItem = {
  id: number
  /** data/exercises/<file> */
  file: string
  /** app URL of the baked loop, null until one is baked */
  loop: string | null
  /** set when the manifest names a loop file that is not on disk */
  loopMissing?: string
  poster: string | null
  /** figure contact sheet served by the middleware, null when not rendered */
  sheet: string | null
  fields: ReviewFields
}

export type QueueResponse = {
  /** manifest: public/media/manifest.json; baked: no manifest yet, queue from the baked motion files */
  source: 'manifest' | 'baked'
  manifestError?: string
  items: ReviewItem[]
  /** motion ids the queue could not resolve to exactly one record */
  missing: number[]
}

export type DecisionRequest = { id: number; decision: Decision; note: string }
export type RestoreRequest = { id: number; fields: ReviewFields }
export type DecisionResponse = { item: ReviewItem; previous: ReviewFields }
