import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { idParam, sheetParam } from '../app/search'
import { SettingsScreen } from '../features/settings/SettingsScreen'

// URL contract: /settings?sheet=equipment|overrides|custom (&id=new|c1..c63 for custom)
const SettingsSearch = z.object({
  sheet: sheetParam(['equipment', 'overrides', 'custom']),
  id: idParam,
})

export const Route = createFileRoute('/settings')({
  validateSearch: SettingsSearch,
  component: SettingsScreen,
})
