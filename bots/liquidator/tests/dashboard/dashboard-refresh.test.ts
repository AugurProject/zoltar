import { afterEach, describe, expect, test } from 'bun:test'
import { Browser } from 'happy-dom'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'

const servers: ReturnType<typeof startDashboardServer>[] = []
const browsers: Browser[] = []

afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true)
	for (const browser of browsers.splice(0)) await browser.close()
})

function state(error?: string, alerts: { message: string; severity: 'error' | 'warning' }[] = []) {
	return {
		activities: [],
		alerts,
		error,
		execute: false,
		metrics: {
			approvedUniverseCount: 1,
			assumedDebtEth: '0',
			candidateCount: 0,
			deployedRep: '0',
			eligiblePoolCount: 1,
			poolCount: 1,
			selectedPoolCount: 1,
			walletEth: '1',
			walletRep: '2',
		},
		paused: false,
		pendingTransactions: [],
		pools: [
			{
				activeVaultCount: '0',
				address: '0x1111111111111111111111111111111111111111',
				approvedUniverse: true,
				botVault: { address: '0x2', allowanceEth: '0', rep: '0', unpaidEthFees: '0' },
				candidates: [],
				collateralEth: '0',
				centralizedPriceAllowed: true,
				isPriceValid: true,
				lastPrice: '1',
				multiplierBps: '10000',
				questionId: '7',
				selected: true,
				systemState: '0',
				totalAllowanceEth: '0',
				totalRep: '0',
				truncatedVaults: false,
				universeId: '1',
			},
		],
		scanning: false,
		status: 'running',
		marketSources: [],
		universes: [
			{
				approved: true,
				forkedPoolCount: 0,
				forkQuestionId: '7',
				forkTime: '0',
				id: '1',
				migratableVaultCount: 0,
				operationalPoolCount: 1,
				poolCount: 1,
				repToken: '0x3',
				selectedPoolCount: 1,
			},
		],
	}
}

async function dashboard() {
	const server = startDashboardServer(0, {
		getConfiguration: () => ({}),
		getState: () => ({}),
		hostname: '127.0.0.1',
		setApprovedUniverses: value => value,
		setPaused: value => value,
		setSelectedPools: value => value,
		setSigner: value => value,
		setStrategy: value => value,
	})
	servers.push(server)
	const browser = new Browser({
		settings: {
			enableJavaScriptEvaluation: true,
			suppressInsecureJavaScriptEnvironmentWarning: true,
		},
	})
	browsers.push(browser)
	const page = browser.newPage()
	page.url = server.url.href
	page.content = await (await fetch(server.url)).text()
	const window = page.mainFrame.window
	Reflect.set(window, 'Map', Map)
	Reflect.set(window, 'Set', Set)
	Reflect.set(window, 'JSON', JSON)
	const refreshCallbacks: (() => unknown)[] = []
	window.setInterval = handler => {
		if (typeof handler === 'function') refreshCallbacks.push(() => handler())
		const timeout = window.setTimeout(() => undefined, 1)
		window.clearTimeout(timeout)
		return timeout
	}
	let snapshot = state('rpc secret at /api/internal')
	let rejectPause = false
	window.fetch = async input => {
		const inputUrl = typeof input === 'string' ? input : input instanceof window.URL ? input.href : Reflect.get(input, 'url')
		if (typeof inputUrl !== 'string') throw new Error('Unexpected request URL')
		const url = new URL(inputUrl, server.url)
		if (url.pathname === '/api/configuration') {
			return new window.Response(JSON.stringify({ approvedUniverses: ['1'], selectedPools: ['0x1111111111111111111111111111111111111111'], strategy: {} }), {
				headers: { 'content-type': 'application/json' },
			})
		}
		if (url.pathname === '/api/state') return new window.Response(JSON.stringify(snapshot), { headers: { 'content-type': 'application/json' } })
		if (url.pathname === '/api/test-market-sources') {
			return new window.Response(JSON.stringify({ assets: [{ assetId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sources: [{ id: 'uniswap-v2', kind: 'dex', market: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', status: 'observed' }] }], blockNumber: '42' }), { headers: { 'content-type': 'application/json' } })
		}
		if (url.pathname === '/api/paused' && rejectPause) {
			return new window.Response(JSON.stringify({ error: 'Fixture rejected /api/paused with secret' }), { headers: { 'content-type': 'application/json' }, status: 400 })
		}
		return new window.Response('{}', { headers: { 'content-type': 'application/json' } })
	}
	page.evaluate(await (await fetch(new URL('/dashboard.js', server.url))).text())
	await page.waitUntilComplete()
	const refresh = refreshCallbacks[0]
	if (refresh === undefined) throw new Error('Dashboard did not register its refresh interval')
	return {
		refresh: async () => {
			await refresh()
			await page.waitUntilComplete()
		},
		rejectPause: (reject: boolean) => {
			rejectPause = reject
		},
		setSnapshot: (next: ReturnType<typeof state>) => {
			snapshot = next
		},
		window,
		waitUntilComplete: () => page.waitUntilComplete(),
	}
}

describe('liquidator dashboard refresh behavior', () => {
	test('preserves focused controls and expanded pool addresses across polling', async () => {
		const page = await dashboard()
		const checkbox = page.window.document.querySelector('[data-record-key^="pool:"]')
		const details = page.window.document.querySelector('details[data-pool-address]')
		if (!(checkbox instanceof page.window.HTMLInputElement) || !(details instanceof page.window.HTMLDetailsElement)) throw new Error('Expected pool controls')
		const recordKey = checkbox.getAttribute('data-record-key')
		checkbox.focus()
		details.open = true

		page.setSnapshot(state())
		await page.refresh()
		await page.refresh()

		expect(page.window.document.activeElement?.getAttribute('data-record-key')).toBe(recordKey)
		const refreshedDetails = page.window.document.querySelector('details[data-pool-address]')
		expect(refreshedDetails instanceof page.window.HTMLDetailsElement && refreshedDetails.open).toBe(true)
	})

	test('does not repeat unchanged alerts and sanitizes mutation failures', async () => {
		const page = await dashboard()
		const globalError = page.window.document.getElementById('global-error')
		const operatorAlerts = page.window.document.getElementById('operator-alerts')
		if (globalError === null || operatorAlerts === null) throw new Error('Expected dashboard alerts')
		expect(operatorAlerts.getAttribute('role')).toBe('alert')
		expect(operatorAlerts.getAttribute('aria-live')).toBe('assertive')
		expect(globalError.textContent).toContain('Check the bot logs')
		expect(globalError.textContent).not.toContain('/api/internal')
		let mutations = 0
		const observer = new page.window.MutationObserver(records => {
			mutations += records.length
		})
		observer.observe(globalError, { attributes: true, childList: true, subtree: true })

		await page.refresh()
		await page.refresh()
		expect(mutations).toBe(0)
		page.setSnapshot(state(undefined, [{ message: 'Execution is blocked for recovery', severity: 'error' }]))
		await page.refresh()
		let alertMutations = 0
		const alertObserver = new page.window.MutationObserver(records => {
			alertMutations += records.length
		})
		alertObserver.observe(operatorAlerts, { attributes: true, childList: true, subtree: true })
		await page.refresh()
		expect(alertMutations).toBe(0)
		const testSources = page.window.document.getElementById('test-market-sources')
		if (!(testSources instanceof page.window.HTMLButtonElement)) throw new Error('Expected source test control')
		testSources.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		const sourceRows = page.window.document.getElementById('market-source-rows')
		expect(sourceRows?.textContent).toContain('Observed')
		expect(sourceRows?.textContent).toContain('admission still requires the persistence and consensus policy')
		expect(sourceRows?.textContent).not.toContain('Admitted')
		await page.refresh()
		expect(sourceRows?.textContent).toContain('Observed')
		expect(sourceRows?.textContent).not.toContain('Admitted')
		expect(page.window.document.getElementById('market-source-test-status')?.textContent).toBe('Source test completed at block 42')
		expect(page.window.document.getElementById('market-source-caption')?.textContent).toBe('Latest source probe (not admission)')
		const showAdmission = page.window.document.getElementById('show-active-admission')
		if (!(showAdmission instanceof page.window.HTMLButtonElement)) throw new Error('Expected active admission control')
		showAdmission.click()
		expect(sourceRows?.textContent).toContain('No market sources are configured.')
		expect(page.window.document.getElementById('market-source-caption')?.textContent).toBe('Configured source admission')
		expect(page.window.document.getElementById('market-source-test-status')?.textContent).toBe('Showing active admission from persisted consensus evidence')

		page.setSnapshot(state())
		await page.refresh()
		expect(globalError.classList.contains('hidden')).toBe(true)
		expect(globalError.textContent).toBe('')

		page.rejectPause(true)
		const pauseButton = page.window.document.getElementById('pause-button')
		if (!(pauseButton instanceof page.window.HTMLButtonElement)) throw new Error('Expected pause button')
		pauseButton.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		const pauseStatus = page.window.document.getElementById('pause-status')
		expect(pauseStatus?.textContent).toContain('Check the bot connection and retry')
		expect(pauseStatus?.textContent).not.toContain('/api/paused')
		expect(page.window.document.body.textContent).not.toContain('Fixture rejected')
	})
})
