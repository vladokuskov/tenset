import { CalendarDays, Dumbbell, PersonStanding, type LucideIcon } from 'lucide-react'

export type NavItem = {
  to: '/' | '/body' | '/exercises'
  label: string
  icon: LucideIcon
  /** Other paths that keep this tab current (pushed screens under it). */
  match: RegExp
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Plan', icon: CalendarDays, match: /^\/(day\/.*)?$/ },
  { to: '/body', label: 'Body', icon: PersonStanding, match: /^\/body\/?$/ },
  { to: '/exercises', label: 'Exercises', icon: Dumbbell, match: /^\/exercises?(\/.*)?$/ },
]
