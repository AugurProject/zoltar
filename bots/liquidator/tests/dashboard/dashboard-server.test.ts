import { afterEach, describe, expect, test } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'

const servers: ReturnType<typeof startDashboardServer>[] = []

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

describe('liquidator dashboard server', () => {
	test('serves the dashboard and protects configuration mutations by origin', async () => {
		let paused = false
		let marketConfiguration: unknown
		let networkConnectivity: unknown
		let reconciliation: unknown
		const server = startDashboardServer(0, {
			getConfiguration: () => ({ selectedPools: [], strategy: {} }),
			getState: () => ({ paused }),
			hostname: '127.0.0.1',
			reconcileTransaction: value => {
				reconciliation = value
				return value
			},
			setApprovedUniverses: value => value,
			setMarketConfiguration: value => {
				marketConfiguration = value
				return value
			},
			setNetworkConnectivity: value => {
				networkConnectivity = value
				return value
			},
			setPaused: value => {
				paused = Reflect.get(value as object, 'paused') === true
				return { paused }
			},
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
			testMarketSources: () => ({ assets: [], blockNumber: '1' }),
		})
		servers.push(server)
		const health = await fetch(new URL('/healthz', server.url))
		expect(health.status).toBe(200)
		expect(await health.text()).toBe('ok')
		const page = await fetch(server.url)
		expect(page.status).toBe(200)
		const pageSource = await page.text()
		expect(pageSource).toContain('Pool liquidator')
		expect(pageSource).toContain('id="centralized-market-status" class="muted" role="status" aria-live="polite"')
		expect(pageSource).toContain('id="centralized-market-summary" class="metric-grid"')
		expect(pageSource).not.toContain('id="centralized-market-summary" class="metric-grid" aria-live')
		expect(pageSource).toContain('id="centralized-market-price"')
		expect(pageSource).toContain('id="dex-market-price"')
		expect(pageSource).toContain('id="guarded-market-price"')
		expect(pageSource).toContain('id="market-configuration-json"')
		expect(pageSource).toContain('id="network-name"')
		expect(pageSource).toContain('id="test-market-sources"')
		expect(pageSource).toContain('id="recovery-list"')
		expect(pageSource).not.toContain('public CCXT sources')
		expect(pageSource).toContain('id="metrics" class="metric-grid"')
		expect(pageSource).not.toContain('id="metrics" class="metric-grid" aria-live')
		const rejected = await fetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true }),
			headers: {
				'content-type': 'application/json',
				origin: 'https://attacker.example',
			},
			method: 'PUT',
		})
		expect(rejected.status).toBe(403)
		const accepted = await fetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true }),
			headers: {
				'content-type': 'application/json',
				origin: server.url.origin,
			},
			method: 'PUT',
		})
		expect(accepted.status).toBe(200)
		expect(paused).toBe(true)
		const marketMutation = await fetch(new URL('/api/market-configuration', server.url), {
			body: JSON.stringify({ sources: [] }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		expect(marketMutation.status).toBe(200)
		expect(marketConfiguration).toEqual({ sources: [] })
		const networkMutation = await fetch(new URL('/api/network-connectivity', server.url), {
			body: JSON.stringify({ connectivity: { publicRpcUrls: ['https://rpc.example'], quorumRpcUrls: [], readRpcUrl: 'https://rpc.example' }, network: 'sepolia' }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		expect(networkMutation.status).toBe(200)
		expect(networkConnectivity).toEqual({ connectivity: { publicRpcUrls: ['https://rpc.example'], quorumRpcUrls: [], readRpcUrl: 'https://rpc.example' }, network: 'sepolia' })
		const sourceTest = await fetch(new URL('/api/test-market-sources', server.url), {
			body: '{}',
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		expect(sourceTest.status).toBe(200)
		const recoveryRequest = { intentHash: `0x${'1'.repeat(64)}`, replacementHash: `0x${'2'.repeat(64)}` }
		const recovery = await fetch(new URL('/api/reconcile-transaction', server.url), {
			body: JSON.stringify(recoveryRequest),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		expect(recovery.status).toBe(200)
		expect(reconciliation).toEqual(recoveryRequest)
	})

	test('accepts loopback browser requests when bound to all interfaces', async () => {
		let paused = false
		const password = 'correct horse battery staple'
		expect(() =>
			startDashboardServer(0, {
				getConfiguration: () => ({}),
				getState: () => ({}),
				hostname: '0.0.0.0',
				setApprovedUniverses: value => value,
				setPaused: value => value,
				setSelectedPools: value => value,
				setSigner: value => value,
				setStrategy: value => value,
			}),
		).toThrow('ZOLTAR_BOT_DASHBOARD_PASSWORD')
		const server = startDashboardServer(0, {
			getConfiguration: () => ({}),
			getState: () => ({ paused }),
			hostname: '0.0.0.0',
			password,
			setApprovedUniverses: value => value,
			setPaused: value => {
				paused = Reflect.get(value as object, 'paused') === true
				return { paused }
			},
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
		})
		servers.push(server)
		const origin = `http://127.0.0.1:${server.port}`
		const unauthorized = await fetch(origin)
		expect(unauthorized.status).toBe(401)
		expect(unauthorized.headers.get('www-authenticate')).toContain('Basic')
		const authorization = `Basic ${Buffer.from(`operator:${password}`).toString('base64')}`
		const page = await fetch(origin, { headers: { authorization } })
		expect(page.status).toBe(200)
		const mutation = await fetch(`${origin}/api/paused`, {
			body: JSON.stringify({ paused: true }),
			headers: {
				authorization,
				'content-type': 'application/json',
				origin,
			},
			method: 'PUT',
		})
		expect(mutation.status).toBe(200)
		expect(paused).toBe(true)
	})
})
