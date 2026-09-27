import { describe, expect, it } from 'vitest'
import { safariTabPlatform, type InstallEnv } from './install'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1'
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

const env = (userAgent: string, patch: Partial<InstallEnv> = {}): InstallEnv => ({
  userAgent,
  displayStandalone: false,
  maxTouchPoints: 5,
  ...patch,
})

describe('safariTabPlatform', () => {
  it('detects Safari tabs', () => {
    expect(safariTabPlatform(env(IPHONE_SAFARI, { standalone: false }))).toBe('ios')
    expect(safariTabPlatform(env(MAC_SAFARI, { maxTouchPoints: 5 }))).toBe('ios') // iPadOS desktop UA
    expect(safariTabPlatform(env(MAC_SAFARI, { maxTouchPoints: 0 }))).toBe('mac')
  })

  it('skips installed apps and other browsers', () => {
    expect(safariTabPlatform(env(IPHONE_SAFARI, { standalone: true }))).toBeNull()
    expect(safariTabPlatform(env(IPHONE_SAFARI, { displayStandalone: true }))).toBeNull()
    expect(safariTabPlatform(env(IPHONE_CHROME))).toBeNull()
    expect(safariTabPlatform(env(MAC_CHROME, { maxTouchPoints: 0 }))).toBeNull()
  })
})
