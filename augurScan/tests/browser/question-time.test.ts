import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, origin, qaViewports, writeScreenshot } from './browser-test.ts'

for (const viewport of qaViewports) {
	for (const distant of [false, true]) {
		browserTest(
			`question dates remain readable at ${viewport.width}px (distant=${distant})`,
			async () => {
				const route = `${origin}/system?demo=1&tab=questions${distant ? '&questionTime=out-of-range' : ''}`
				await withBrowserPage(
					route,
					viewport,
					async session => {
						const { evaluate } = session
						for (let attempt = 0; attempt < 100; attempt++) {
							if (await evaluate(`document.querySelector('#state-detail')?.textContent.includes('Question definition') ?? false`)) break
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
						await writeScreenshot(session, `/tmp/augurscan-question-${viewport.width}-${distant ? 'distant' : 'normal'}.png`, { captureBeyondViewport: false })
						expect(session.issues).toEqual([])
					},
					{ awaitPromise: false },
				)
			},
			30_000,
		)
	}
}
