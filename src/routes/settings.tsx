import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { groupParam, idParam, sheetParam } from '../app/search'
import { SettingsScreen } from '../features/settings/SettingsScreen'

// URL contract: /settings?sheet=equipment|overrides|custom|targets (&id=new|c1..c63 for custom, &group=<id> for targets)
const SettingsSearch = z.object({
  sheet: sheetParam(['equipment', 'overrides', 'custom', 'targets']),
  id: idParam,
  group: groupParam,
})

export const Route = createFileRoute('/settings')({
  validateSearch: SettingsSearch,
  component: SettingsScreen,
})
