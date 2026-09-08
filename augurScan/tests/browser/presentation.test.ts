import { expect, test } from 'bun:test'
import { createDevToolsSession } from '../../../tooling/ui/browserSmoke.mts'

// Run against `bun run qa:serve`; the demo emits a new block every 2.5 seconds.
const origin = process.env['AUGURSCAN_BROWSER_URL']
const browserTest = origin === undefined ? test.skip : test

for (const viewport of [
	{ width: 1440, height: 900 },
	{ width: 390, height: 844 },
]) {
	browserTest(
		`log toggles and live refresh preserve reading context at ${viewport.width}px`,
		async () => {
			const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/?demo=1&streamDemo=1`, viewport)
			const evaluate = async (expression: string): Promise<unknown> => {
				const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
				if (typeof response !== 'object' || response === null) throw new Error('Missing browser response')
				if ('exceptionDetails' in response && response['exceptionDetails']) throw new Error(JSON.stringify(response['exceptionDetails']))
				if (!('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
				return response.result.value
			}
			const waitFor = async (expression: string) => {
				for (let attempt = 0; attempt < 200; attempt++) {
					if (await evaluate(expression)) return
					await Bun.sleep(100)
				}
				throw new Error(`Timed out: ${expression}`)
			}
			try {
				await session.send('Runtime.enable')
				await session.send('Page.enable')
				await session.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
				await session.send('Page.navigate', { url: session.pageUrl })
				await waitFor(`document.querySelectorAll('.event-name').length > 5`)
				await evaluate(`document.querySelector('.event-name').click()`)
				await waitFor(`!!document.querySelector('.event-detail-content .detail-grid')`)
				await evaluate(`document.querySelector('.event-name').click()`)
				expect(await evaluate(`!!document.querySelector('.event-detail-drawer')`)).toBe(false)
				await evaluate(`document.querySelector('.event-name').click()`)
				await waitFor(`!!document.querySelector('.event-detail-content .detail-grid')`)
				expect(await evaluate(`document.querySelector('.event-name').getAttribute('aria-expanded')`)).toBe('true')
				expect(await evaluate(`document.querySelectorAll('.log-integrity, .event-detail-header button').length`)).toBe(0)
				await evaluate(`document.querySelector('details[data-disclosure-key="transaction-receipt"]').open = true; window.scrollTo(0, 650)`)
				const scroll = await evaluate('window.scrollY')
				await evaluate(`window.qaBlock = document.querySelector('.log-row').dataset.liveKey`)
				await waitFor(`document.querySelector('.log-row').dataset.liveKey !== window.qaBlock`)
				await Bun.sleep(500)
				expect(await evaluate('window.scrollY')).toBe(scroll)
				expect(await evaluate(`document.querySelector('details[data-disclosure-key="transaction-receipt"]').open`)).toBe(true)
				await session.send('Page.navigate', { url: `${origin}/system?demo=1&streamDemo=1&tab=universes` })
				await waitFor(`document.querySelector('#state-detail')?.textContent.includes('Genesis universe')`)
				await evaluate(`
					window.scrollTo(0, 600)
					window.qaStateUpdates = 0
					window.qaStateFlashed = false
					new MutationObserver(records => {
						if (records.some(record => record.type === 'childList')) window.qaStateUpdates++
						if (document.querySelector('#state-detail').classList.contains('live-changed')) window.qaStateFlashed = true
					}).observe(document.querySelector('#state-detail'), { childList: true, attributes: true, attributeFilter: ['class'] })
				`)
				const systemScroll = await evaluate('window.scrollY')
				await waitFor(`window.qaStateUpdates > 0`)
				await Bun.sleep(500)
				expect(await evaluate('window.scrollY')).toBe(systemScroll)
				expect(await evaluate('window.qaStateFlashed')).toBe(false)
				await session.send('Page.navigate', { url: `${origin}/contracts?demo=1` })
				await waitFor(`document.querySelectorAll('.contract-row').length > 1`)
				expect(
					await evaluate(
						`document.querySelectorAll('.contract-row .eyebrow, .contract-group-heading, .contract-row-facts, .contract-row .detail-tools').length`,
					),
				).toBe(0)
				expect(await evaluate(`document.querySelector('.contract-row .deployment-status').getAttribute('href').includes('/block/')`)).toBe(true)
				expect(await evaluate(`document.querySelector('.contract-address-link').getAttribute('href').includes('/address/')`)).toBe(true)
				expect(
					await evaluate(
						`(() => { const rows = [...document.querySelectorAll('.contract-row')]; return rows[1].getBoundingClientRect().top >= rows[0].getBoundingClientRect().bottom })()`,
					),
				).toBe(true)
				expect(
					await evaluate(
						`(() => { const block = document.querySelector('.block-number').getBoundingClientRect(); const badge = document.querySelector('.network-title .badge').getBoundingClientRect(); return badge.top < block.bottom && block.top < badge.bottom })()`,
					),
				).toBe(true)
				expect(await evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true)
				expect(session.issues).toEqual([])
			} finally {
				await session.close()
			}
		},
		60_000,
	)
}
