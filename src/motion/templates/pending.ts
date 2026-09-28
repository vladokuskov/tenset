import { SCHEMAS, type ParamsOf, type TemplateId } from './schemas.ts'
import type { Driver, Template } from './types.ts'

/** a template whose motion is not authored yet: its params parse, setup() and sample() throw */
export function pendingTemplate<T extends TemplateId>(id: T, driver: Driver): Template<ParamsOf<T>> {
  const fail = () => {
    throw new Error(`motion template ${id}: sample() not implemented yet`)
  }
  return { id, driver, params: SCHEMAS[id] as never, implemented: false, setup: fail, sample: fail }
}
