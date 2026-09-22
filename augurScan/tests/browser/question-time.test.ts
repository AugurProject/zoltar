import { expect, test } from 'bun:test'
import { createDevToolsSession } from '../../../tooling/ui/browserSmoke.mts'

const origin = process.env['AUGURSCAN_BROWSER_URL']
const browserTest = origin === undefined ? test.skip : test

for (const viewport of [
	{ width: 1440, height: 900 },
	{ width: 390, height: 844 },
]) {
	for (const distant of [false, true]) {
		browserTest(
			`question dates remain readable at ${viewport.width}px (distant=${distant})`,
			async () => {
				const route = `${origin}/system?demo=1&tab=questions${distant ? '&questionTime=out-of-range' : ''}`
				const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/local/bin/chromium', route, viewport)
				const evaluate = async (expression: string): Promise<unknown> => {
					const response = await session.send('Runtime.evaluate', { expression, returnByValue: true })
					if (typeof response !== 'object' || response === null || !('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) throw new Error('Missing browser result')
					return response.result.value
				}
				try {
					await session.send('Runtime.enable')
					await session.send('Page.enable')
					await session.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
					await session.send('Page.navigate', { url: route })
					for (let attempt = 0; attempt < 100; attempt++) {
						if (await evaluate(`document.querySelector('#state-detail')?.textContent.includes('Question definition')`)) break
						await Bun.sleep(100)
					}
					const text = await evaluate(`document.querySelector('#state-detail')?.textContent`)
					expect(text).toContain('Question definition')
					expect(text).not.toContain('Invalid Date')
					if (distant) {
						expect(text).toContain('Scheduled')
						expect(text).toContain('Date out of range (8640000000001 Unix seconds)')
						expect(text).toContain('Date out of range (281474976710655 Unix seconds)')
					} else {
						expect(text).toContain('Open')
						expect(text).not.toContain('Date out of range')
					}
					expect(await evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
					expect(await evaluate(`[...document.querySelectorAll('.timeline-step')].every(step => step.scrollWidth <= step.clientWidth)`)).toBe(true)
					await evaluate(`document.querySelector('#state-detail').scrollIntoView(); true`)
					const screenshot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
					if (typeof screenshot !== 'object' || screenshot === null || !('data' in screenshot) || typeof screenshot.data !== 'string') throw new Error('Missing screenshot')
					await Bun.write(`/tmp/augurscan-question-${viewport.width}-${distant ? 'distant' : 'normal'}.png`, Buffer.from(screenshot.data, 'base64'))
					expect(session.issues).toEqual([])
				} finally {
					await session.close()
				}
			},
			30_000,
		)
	}
}
