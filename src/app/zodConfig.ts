import { z } from 'zod'

// Without this, zod probes `new Function` once, which a strict CSP reports as a violation.
z.config({ jitless: true })
