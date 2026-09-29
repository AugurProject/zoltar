import { test } from 'bun:test'
import type { DevToolsSession } from '../../../tooling/ui/browserSmoke.mts'

// Chromium tests run against `bun run qa:serve` and skip when AUGURSCAN_BROWSER_URL is unset.
export const origin = process.env['AUGURSCAN_BROWSER_URL']
export const browserTest = origin === undefined ? test.skip : test
export const desktopViewport = { width: 1440, height: 900 }
export const mobileViewport = { width: 390, height: 844 }
export const qaViewports = [desktopViewport, mobileViewport]

export const writeScreenshot = async (session: DevToolsSession, filename: string, options: Record<string, unknown> = {}) => {
	const screenshot = await session.send('Page.captureScreenshot', { format: 'png', ...options })
	if (typeof screenshot !== 'object' || screenshot === null || !('data' in screenshot) || typeof screenshot.data !== 'string') throw new Error('Missing screenshot')
	await Bun.write(filename, Buffer.from(screenshot.data, 'base64'))
}
