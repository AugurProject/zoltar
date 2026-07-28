import { afterEach, expect, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import { startDashboardServer } from './dashboard-server.js'
import { operatorSnapshot, updateStrategyFromRequest, type MutableStrategy, type OperatorState } from './operator-state.js'
import { validateSubmissionSettings } from './transaction-submission.js'

const servers: ReturnType<typeof startDashboardServer>[] = []
const address = '0x0000000000000000000000000000000000000001' as Address

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

test('serves dashboard state and protects mutable controls with same-origin JSON requests', async () => {
	const strategy: MutableStrategy = {
		maxSpotTwapTicks: 100n,
		minimumProfitBps: 100n,
		minimumProfitWeth: 10n ** 16n,
		minimumRemainingBlocks: 3n,
		minimumRemainingSeconds: 36n,
		pollMilliseconds: 12_000,
		twapSeconds: 1_800,
	}
	const state: OperatorState = {
		activeReportCount: 0,
		balances: undefined,
		blockNumber: '100',
		blockTimestamp: '1000',
		executionHistory: [],
		endpointChecks: [],
		gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
		lastError: undefined,
		lastPollAt: undefined,
		opportunities: [],
		operationLog: [],
		paused: false,
		positions: [],
		status: 'running',
		tokenAddresses: [],
		tokenMarkets: [],
		priceHistory: [],
		reportPaths: [],
		transactionActivity: [],
	}
	let submission = validateSubmissionSettings({ mode: 'public', relayUrls: ['https://relay.flashbots.net'] })
	let connectivity = { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' }
	let queuedWallet: Address | null | undefined
	let savedWallet: Address | undefined
	const server = startDashboardServer(0, {
		getSnapshot: () => operatorSnapshot(state, strategy, submission, connectivity, { execute: false, executor: undefined, expectedChainId: 1, explorerUrl: 'https://etherscan.io', network: 'mainnet', openOracle: address, queuedWallet, savedWallet, wallet: undefined }),
		setPaused: paused => {
			state.paused = paused
		},
		updateConnectivity: value => {
			if (typeof value !== 'object' || value === null || !('readRpcUrl' in value) || !('publicRpcUrls' in value) || typeof value.readRpcUrl !== 'string' || !Array.isArray(value.publicRpcUrls)) throw new Error('Invalid test connectivity')
			connectivity = { publicRpcUrls: value.publicRpcUrls.map(String), readRpcUrl: value.readRpcUrl }
			return connectivity
		},
		updateSigner: value => {
			if (typeof value === 'object' && value !== null && 'forgetSavedSigner' in value) {
				savedWallet = undefined
				return { wallet: address }
			}
			const clear = typeof value === 'object' && value !== null && 'privateKey' in value && value['privateKey'] === null
			queuedWallet = clear ? null : address
			savedWallet = clear ? undefined : address
			return { wallet: clear ? undefined : address }
		},
		updateSubmission: value => {
			submission = validateSubmissionSettings(value)
			return submission
		},
		updateStrategy: value => updateStrategyFromRequest(strategy, value),
		updateTokens: value => {
			if (!Array.isArray(value)) throw new Error('Invalid token list')
			return value.map(String)
		},
	})
	servers.push(server)
	const origin = `http://${server.hostname}:${server.port}`
	const page = await fetch(origin)
	expect(page.status).toBe(200)
	expect(page.headers.get('content-security-policy')).toContain("default-src 'self'")
	const pageSource = await page.text()
	expect(pageSource).toContain('OpenOracle Arbitrager')
	expect(pageSource).not.toContain('>Starting<')
	expect(pageSource).toContain('id="mode-badge" class="badge">Mode —</span>')
	expect(pageSource).toContain('id="status-value">—</strong>')
	expect(pageSource).toContain('id="pause-button" class="button" type="button" disabled')
	expect(pageSource).toContain('id="hedged-profit-value"')
	expect(pageSource).toContain('id="game-capital-value"')
	expect(pageSource).toContain('id="strategy-fieldset" disabled')
	expect(pageSource).toContain('id="submission-fieldset" disabled')
	expect(pageSource).toContain('Live execution requires private relays so approvals, hedge, and dispute remain atomic.')
	expect(pageSource).toContain('id="connectivity-fieldset" disabled')
	expect(pageSource).toContain('id="signer-fieldset" disabled')
	expect(pageSource).toContain('id="signer-status" class="muted" role="status" aria-live="polite"')
	expect(pageSource).toContain('aria-describedby="signer-status"')
	expect(pageSource).toContain('id="remember-signer" type="checkbox"')
	expect(pageSource).toContain('id="forget-signer-button"')
	expect(pageSource).toContain('Save this new key in plaintext')
	expect(pageSource).toContain('Clear signer &amp; saved key')
	expect(pageSource).toContain('Observed dispute paths')
	expect(pageSource).toContain('Spot (WETH/token)')
	expect(pageSource).not.toContain('id="launch-gate-link"')
	expect(pageSource).toContain('id="launch-notice"')
	const favicon = await fetch(`${origin}/favicon.ico`)
	expect(favicon.status).toBe(204)
	expect(favicon.headers.get('content-type')).toBe('image/x-icon')
	const browserScript = await fetch(`${origin}/dashboard.js`)
	expect(browserScript.headers.get('content-type')).toContain('text/javascript')
	const browserSource = await browserScript.text()
	expect(browserSource).toContain('setInterval')
	expect(browserSource).toContain('aria-labelledby')
	expect(browserSource).toContain('Recent exact price samples')
	expect(browserSource).toContain('Mainnet execution network')
	expect(browserSource).toContain('Sepolia rehearsal network')
	expect(browserSource).toContain('details.dataset["reportId"]')
	expect(browserSource).toContain('focus({ preventScroll: true })')
	expect(browserSource).toContain('stroke-dasharray')
	const browserFormatScript = await fetch(`${origin}/dashboard-format.js`)
	expect(browserFormatScript.headers.get('content-type')).toContain('text/javascript')
	expect(await browserFormatScript.text()).toContain('sumSignedDecimals')
	const crossOrigin = await fetch(`${origin}/api/paused`, {
		body: JSON.stringify({ paused: true }),
		headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
		method: 'PUT',
	})
	expect(crossOrigin.status).toBe(403)
	const rebound = await fetch(`${origin}/api/paused`, {
		body: JSON.stringify({ paused: false }),
		headers: {
			'content-type': 'application/json',
			host: 'attacker.example',
			origin: 'http://attacker.example',
		},
		method: 'PUT',
	})
	expect(rebound.status).toBe(403)
	const pause = await fetch(`${origin}/api/paused`, {
		body: JSON.stringify({ paused: true }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(pause.status).toBe(200)
	expect(state.paused).toBe(true)
	const update = await fetch(`${origin}/api/settings`, {
		body: JSON.stringify({
			maxSpotTwapTicks: '75',
			minimumProfitBps: '200',
			minimumProfitWeth: '0.025',
			minimumRemainingBlocks: '4',
			minimumRemainingSeconds: '48',
			pollMilliseconds: 15_000,
			twapSeconds: 2_400,
		}),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(update.status).toBe(200)
	expect(strategy.minimumProfitWeth).toBe(25n * 10n ** 15n)
	const submissionUpdate = await fetch(`${origin}/api/submission`, {
		body: JSON.stringify({ mode: 'private', relayUrls: ['https://relay.flashbots.net', 'https://relay.example'] }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(submissionUpdate.status).toBe(200)
	expect(submission.mode).toBe('private')
	expect(submission.relayUrls).toHaveLength(2)
	const connectivityUpdate = await fetch(`${origin}/api/connectivity`, {
		body: JSON.stringify({ publicRpcUrls: ['https://submit.example'], readRpcUrl: 'https://read.example' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(connectivityUpdate.status).toBe(200)
	expect(connectivity.readRpcUrl).toBe('https://read.example')
	const tokenUpdate = await fetch(`${origin}/api/tokens`, {
		body: JSON.stringify([address]),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(tokenUpdate.status).toBe(200)
	expect(await tokenUpdate.json()).toEqual({ tokenAddresses: [address] })
	const signerUpdate = await fetch(`${origin}/api/signer`, {
		body: JSON.stringify({ privateKey: 'not returned by test controller', rememberSigner: true }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(signerUpdate.status).toBe(200)
	expect(await signerUpdate.json()).toEqual({ wallet: address })
	const reloadedState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(reloadedState).toMatchObject({ queuedWallet: address })
	expect(reloadedState).toMatchObject({ savedWallet: address })
	const forgetSigner = await fetch(`${origin}/api/signer`, {
		body: JSON.stringify({ forgetSavedSigner: true }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(forgetSigner.status).toBe(200)
	const forgottenState = (await fetch(`${origin}/api/state`).then(response => response.json())) as Record<string, unknown>
	expect(forgottenState).toMatchObject({ queuedWallet: address })
	expect(forgottenState['savedWallet']).toBeUndefined()
	const signerClear = await fetch(`${origin}/api/signer`, {
		body: JSON.stringify({ privateKey: null, rememberSigner: false }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(signerClear.status).toBe(200)
	const clearReloadedState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(clearReloadedState).toMatchObject({ queuedWallet: null })
})

test('returns a structured unavailable response when the initial state read fails', async () => {
	const server = startDashboardServer(0, {
		getSnapshot: () => {
			throw new Error('RPC unavailable')
		},
		setPaused: () => undefined,
		updateConnectivity: () => {
			throw new Error('Connectivity unavailable')
		},
		updateSigner: () => {
			throw new Error('Signer unavailable')
		},
		updateSubmission: () => {
			throw new Error('Submission unavailable')
		},
		updateStrategy: () => {
			throw new Error('Settings unavailable')
		},
	})
	servers.push(server)
	const response = await fetch(`http://${server.hostname}:${server.port}/api/state`)
	expect(response.status).toBe(503)
	expect(await response.json()).toEqual({ error: 'RPC unavailable' })
})
