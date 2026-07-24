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
		executionHistory: [],
		lastError: undefined,
		lastPollAt: undefined,
		opportunities: [],
		paused: false,
		status: 'sleeping',
		transactionActivity: [],
	}
	let submission = validateSubmissionSettings({ mode: 'public', relayUrls: ['https://relay.flashbots.net'] })
	const server = startDashboardServer(0, {
		getSnapshot: () => operatorSnapshot(state, strategy, submission, { execute: false, openOracle: address, wallet: undefined }),
		setPaused: paused => {
			state.paused = paused
		},
		updateSubmission: value => {
			submission = validateSubmissionSettings(value)
			return submission
		},
		updateStrategy: value => updateStrategyFromRequest(strategy, value),
	})
	servers.push(server)
	const origin = `http://${server.hostname}:${server.port}`
	const page = await fetch(origin)
	expect(page.status).toBe(200)
	expect(page.headers.get('content-security-policy')).toContain("default-src 'self'")
	const pageSource = await page.text()
	expect(pageSource).toContain('OpenOracle Arbitrager')
	expect(pageSource).toContain('id="pause-button" class="button" type="button" disabled')
	expect(pageSource).toContain('id="strategy-fieldset" disabled')
	expect(pageSource).toContain('id="submission-fieldset" disabled')
	const browserScript = await fetch(`${origin}/dashboard.js`)
	expect(browserScript.headers.get('content-type')).toContain('text/javascript')
	expect(await browserScript.text()).toContain('setInterval')
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
})

test('returns a structured unavailable response when the initial state read fails', async () => {
	const server = startDashboardServer(0, {
		getSnapshot: () => {
			throw new Error('RPC unavailable')
		},
		setPaused: () => undefined,
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
