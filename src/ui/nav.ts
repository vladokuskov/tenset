import { CalendarDays, Dumbbell, PersonStanding, type LucideIcon } from 'lucide-react'

export type NavItem = {
  to: '/' | '/body' | '/exercises'
  labelKey: 'plan' | 'body' | 'exercises'
  icon: LucideIcon
  /** Other paths that keep this tab current (pushed screens under it). */
  match: RegExp
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', labelKey: 'plan', icon: CalendarDays, match: /^\/(day\/.*)?$/ },
  { to: '/body', labelKey: 'body', icon: PersonStanding, match: /^\/body\/?$/ },
  { to: '/exercises', labelKey: 'exercises', icon: Dumbbell, match: /^\/exercises?(\/.*)?$/ },
]
