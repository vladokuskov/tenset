/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { reviewPlugin } from './src/features/review/devServer.ts'

// Everything the service worker precaches. Raise deliberately when baked media lands.
const PRECACHE_BUDGET = 8 * 1024 * 1024

function precacheBudget<T extends { url: string; size: number }>(entries: T[]) {
  const total = entries.reduce((s, e) => s + e.size, 0)
  const kib = (n: number) => `${(n / 1024).toFixed(1)} KiB`
  const largest = [...entries].sort((a, b) => b.size - a.size).slice(0, 5)
  console.log(`\nprecache: ${entries.length} files, ${kib(total)} of ${kib(PRECACHE_BUDGET)} budget`)
  for (const e of largest) console.log(`  ${kib(e.size).padStart(11)}  ${e.url}`)
  if (total > PRECACHE_BUDGET) throw new Error(`Precache is ${kib(total)}, over the ${kib(PRECACHE_BUDGET)} budget`)
  return { manifest: entries }
}

// Review notes (qa.note) are for /dev/review, which reads the record files directly; keep them out of the app bundle.
function stripReviewNotes(): Plugin {
  return {
    name: 'strip-review-notes',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]data[\\/]exercises[\\/][^\\/]+\.json$/.test(id)) return null
      const record = JSON.parse(code) as { qa?: { note?: string } }
      if (!record.qa?.note) return null
      delete record.qa.note
      return { code: JSON.stringify(record), map: null }
    },
  }
}

export default defineConfig({
  plugins: [
    stripReviewNotes(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      injectRegister: 'script',
      registerType: 'prompt',
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'Tenset',
        short_name: 'Tenset',
        description: 'Plan a weekly gym program and see which muscles each day and the whole week train.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // --color-canvas (light); index.html sets the dark theme-color per scheme
        theme_color: '#ece9e5',
        background_color: '#ece9e5',
        categories: ['health', 'fitness', 'sports'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,bin,glb,txt,woff2}', 'models/*.json'],
        // The notices file (~250 KB) is only opened from /credits, so it stays network-only. The figure model and
        // atlas (~1.1 MB) are precached so the detail demos work offline. Loops and posters are cached on first use
        // (src/sw/sw.ts) so the precache does not grow with the catalog.
        globIgnores: ['**/media/loops/**', '**/media/posters/**', '**/THIRD_PARTY_NOTICES.txt'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        manifestTransforms: [precacheBudget],
      },
    }),
    // dev server only: /__review endpoints behind /dev/review
    reviewPlugin(),
  ],
  optimizeDeps: { entries: ['index.html'] },
  test: {
    include: ['src/**/*.test.ts', 'pipeline/**/*.test.ts', 'data/**/*.test.ts', 'api/**/*.test.ts'],
    environment: 'node',
  },
})
