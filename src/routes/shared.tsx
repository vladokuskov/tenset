import { createFileRoute } from '@tanstack/react-router'
import { SharedPreview } from '../features/share/SharedPreview'

// URL contract: /shared#<base64url program>. The program lives in the fragment, never sent to a server.
export const Route = createFileRoute('/shared')({
  component: SharedPreview,
})
