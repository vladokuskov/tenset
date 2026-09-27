/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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

export default defineConfig({
  plugins: [
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
        name: 'Gym Builder',
        short_name: 'Gym Builder',
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
        globPatterns: ['**/*.{js,css,html,svg,png,webp,bin,glb,txt,woff2}'],
        globIgnores: ['**/media/loops/**', '**/models/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        manifestTransforms: [precacheBudget],
      },
    }),
  ],
  optimizeDeps: { entries: ['index.html'] },
  test: {
    include: ['src/**/*.test.ts', 'pipeline/**/*.test.ts', 'data/**/*.test.ts'],
    environment: 'node',
  },
})
