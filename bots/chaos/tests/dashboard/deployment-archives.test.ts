import { expect } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { browserTest, CHROMIUM_STARTUP_BUDGET_MILLISECONDS, chromiumExecutable, startChromiumSession } from '../support/chromium.ts'

const wallet = `0x${'ab'.repeat(20)}`
const id = '12'.repeat(32)
const profileId = `profile:v1:${'34'.repeat(32)}`

browserTest(
	'opens selected archive recovery and renders addresses at desktop and narrow widths',
	async () => {
		let active = 'current'
		let paused = true
		let received: unknown
		let failArchives = false
		let failState = false
		let noArchives = false
		let readStarted = false
		let readDelay: Promise<void> | undefined
		let releaseRead: () => void = () => undefined
		const dashboard = startDashboardServer(0, {
			hostname: '127.0.0.1',
			getConfiguration: () => ({ hasSigner: true, revision: 'config', settings: { network: { chainId: 11155111, name: 'sepolia' }, paused, runtime: { execute: false }, strategy: {} }, wallet }),
			getState: () => {
				if (failState) throw new Error('Intentional bot state read failure')
				return { activities: [], evaluations: [], inventory: { rep: [] }, obligations: [], paused, pendingTransactions: [], profileId, wallet, workflows: [], retirement: { status: active === 'current' ? 'inactive' : 'blocked', recipient: wallet, blockers: [], positions: [] } }
			},
			getDeploymentArchives: async () => {
				readStarted = true
				await readDelay
				if (failArchives) throw new Error('Intentional archive read failure')
				const archives = [
					{ id: 'current', active: active === 'current', revision: 'current-revision', profileId, network: 'sepolia', chainId: 11155111, wallet, status: 'inactive', addresses: [{ name: 'zoltar', address: wallet }] },
					{
						id,
						active: active === id,
						revision: 'archive-revision',
						profileId,
						network: 'sepolia',
						chainId: 11155111,
						wallet,
						status: 'blocked',
						addresses: [
							{ name: 'zoltar', address: wallet },
							{ name: 'uniswapV3Factory', address: `0x${'ef'.repeat(20)}` },
						],
					},
					{ id: '56'.repeat(32), active: false, error: 'Archive configuration and recovery state could not be verified.' },
				]
				return noArchives ? archives.slice(0, 1) : archives
			},
			setDeploymentArchive: value => {
				received = value
				active = id
			},
			setCancellation: () => {},
			setCandidate: () => {},
			setObligation: () => {},
			setPaused: () => {},
			setReplacement: () => {},
			setSettings: () => {},
			setSigner: () => {},
			setWorkflow: () => {},
		})
		const browser = await startChromiumSession(chromiumExecutable, { evaluationDefaults: { exceptions: 'ignore' } })
		async function waitFor(expression: string) {
			for (let attempt = 0; attempt < 200; attempt += 1) {
				if (await browser.evaluate(expression)) return
				await Bun.sleep(25)
			}
			throw new Error(`Archive UI did not reach expected state: ${expression}`)
		}
		async function capture(label: string, width: number) {
			if (process.env['BOT_DASHBOARD_QA_CAPTURE'] !== '1') return
			const result = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
			const data = typeof result === 'object' && result !== null ? Reflect.get(result, 'data') : undefined
			if (typeof data !== 'string') throw new Error('Archive screenshot is missing')
			await Bun.write(`/tmp/bot-dashboard-qa/chaos-archives-${label}-${width.toString()}.png`, Buffer.from(data, 'base64'))
		}
		try {
			await browser.send('Runtime.enable')
			await browser.send('Page.enable')
			for (const [width, height] of [
				[1440, 900],
				[390, 844],
			] as const) {
				readStarted = false
				readDelay = new Promise<void>(resolve => {
					releaseRead = resolve
				})
				received = undefined
				active = 'current'
				paused = true
				await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
				await browser.send('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
				for (let attempt = 0; !readStarted && attempt < 200; attempt += 1) await Bun.sleep(25)
				expect(readStarted).toBeTrue()
				expect(await browser.evaluate("document.querySelector('#deployment-archive-status')?.textContent")).toBe('Checking saved deployments…')
				await capture('loading', width)
				releaseRead()
				readDelay = undefined
				await waitFor("document.querySelector('#deployment-archive-list button')?.disabled === false")
				expect(await browser.evaluate("document.querySelectorAll('#deployment-archive-list .stack-row').length")).toBe(3)
				await browser.evaluate('window.scrollTo(0, 0)')
				await capture('list', width)
				failState = true
				await browser.evaluate("window.dispatchEvent(new Event('focus'))")
				await waitFor("document.querySelector('#global-error')?.classList.contains('hidden') === false && document.querySelector('#deployment-archive-list button')?.disabled === true")
				await capture('stale', width)
				failState = false
				await browser.evaluate("window.dispatchEvent(new Event('focus'))")
				await waitFor("document.querySelector('#global-error')?.classList.contains('hidden') === true && document.querySelector('#deployment-archive-list button')?.disabled === false")
				await browser.evaluate("document.querySelectorAll('#deployment-archive-list details')[1].open = true; document.querySelectorAll('#deployment-archive-list .stack-row')[1].scrollIntoView({ block: 'start' }); window.scrollBy(0, -(document.querySelector('header')?.getBoundingClientRect().height ?? 220) - 16)")
				expect(await browser.evaluate(`document.querySelector('#deployment-archive-list')?.textContent.includes(${JSON.stringify(wallet)})`)).toBeTrue()
				expect(await browser.evaluate('document.body.scrollWidth > innerWidth')).toBeFalse()
				await capture('addresses', width)
				await browser.evaluate(`window.archiveOriginalFetch = window.fetch.bind(window); window.fetch = (input, options) => {
					if (input === '/api/deployment-archive' && options?.method === 'PUT') return Promise.reject(new TypeError('Intentional lost selection response'))
					if (input === '/api/state') return Promise.resolve(new Response('{}', { status: 503 }))
					return window.archiveOriginalFetch(input, options)
				}`)
				await browser.evaluate("document.querySelector('#deployment-archive-list button')?.click()")
				await waitFor("document.querySelector('dialog[open]') !== null")
				await browser.evaluate(
					"document.querySelector('dialog[open] input').value = 'OPEN RECOVERY ' + '12'.repeat(32); document.querySelector('dialog[open] input').dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('dialog[open] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))",
				)
				await waitFor("document.querySelector('#deployment-archive-status')?.textContent.includes('still unknown') === true")
				expect(received).toBeUndefined()
				expect(await browser.evaluate("document.querySelector('#deployment-archive-list button')?.disabled")).toBeTrue()
				await capture('unknown', width)
				await browser.evaluate("window.fetch = window.archiveOriginalFetch; window.dispatchEvent(new Event('focus'))")
				await waitFor("document.querySelector('#global-error')?.classList.contains('hidden') === true && document.querySelector('#deployment-archive-list button')?.disabled === false")
				await capture('retry', width)
				await browser.evaluate("document.querySelector('#deployment-archive-list button')?.click()")
				await waitFor("document.querySelector('dialog[open]') !== null")
				await capture('confirmation', width)
				await browser.evaluate("document.querySelector('dialog[open] input').value = 'OPEN RECOVERY ' + '12'.repeat(32); document.querySelector('dialog[open] input').dispatchEvent(new Event('input', { bubbles: true }))")
				await browser.evaluate("document.querySelector('dialog[open] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))")
				await waitFor("document.querySelector('#deployment-archive-status')?.textContent.includes('Reconnecting') === true")
				for (let attempt = 0; received === undefined && attempt < 200; attempt += 1) await Bun.sleep(25)
				expect(received).toEqual({ id, archiveRevision: 'archive-revision', revision: 'config', confirmation: `OPEN RECOVERY ${id}` })
				await browser.send('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
				await waitFor("document.querySelector('#deployment-archive-list .stack-row:nth-child(2) .badge')?.textContent === 'Selected'")
				expect(await browser.evaluate("document.querySelector('#deployment-archive-list .stack-row:first-child button')?.textContent")).toBe('Open recovery')
				await capture('selected', width)
				paused = false
				await browser.send('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
				await waitFor("document.querySelector('#deployment-archive-status')?.textContent.includes('Pause the bot') === true")
				expect(await browser.evaluate("document.querySelector('#deployment-archive-list button')?.disabled")).toBeTrue()
				await capture('running', width)
				paused = true
				active = 'current'
				noArchives = true
				await browser.send('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
				await waitFor("document.querySelector('#deployment-archive-status')?.textContent === 'No archived deployments.'")
				await capture('empty', width)
				failArchives = true
				await browser.send('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
				await waitFor("document.querySelector('#deployment-archive-retry')?.hidden === false")
				expect(await browser.evaluate("document.querySelector('#deployment-archive-status')?.textContent")).toBe('Deployment archives are temporarily unavailable.')
				await capture('failure', width)
				failArchives = false
				noArchives = false
				await browser.evaluate("document.querySelector('#deployment-archive-retry')?.click()")
				await waitFor("document.querySelector('#deployment-archive-list button')?.disabled === false")
			}
			expect(browser.issues.filter(issue => !((issue.detail.includes('/api/deployment-archives') || issue.detail.includes('/api/state')) && issue.detail.includes('503')))).toEqual([])
		} finally {
			await browser.close()
			dashboard.stop(true)
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 60_000,
)
