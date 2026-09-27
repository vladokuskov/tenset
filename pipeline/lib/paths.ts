import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const CACHE = path.join(ROOT, 'pipeline/.cache')
export const DATA = path.join(ROOT, 'data')
export const PUBLIC = path.join(ROOT, 'public')
