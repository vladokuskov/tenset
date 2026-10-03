import { useMessages } from '../i18n/messages'
import { appMessages } from './messages'

/** Working product name; change here only. */
export const APP_NAME = 'Tenset'

export { notMedicalAdvice } from './messages'

/** The disclaimer line in the current language, for use inside JSX. */
export function NotMedicalAdvice() {
  return useMessages(appMessages).notMedicalAdvice
}
