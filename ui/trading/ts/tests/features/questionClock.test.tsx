import { describe, expect, spyOn, test } from 'bun:test'
import { h } from 'preact'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { ProbabilityBar } from '../../components/ProbabilityBar.js'
import { useQuestionClock } from '../../features/live/useLiveTradingState.js'
import { liveTradingControllerServices, type LiveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { createPublicClient, custom } from '@zoltar/core-shared/evm/ethereum'

const configuration: DeploymentConfiguration = {
	chainId: 31_337,
	chainName: 'Local',
	rpcUrl: 'http://127.0.0.1:8545',
	securityPoolFactory: `0x${'11'.repeat(20)}`,
	factory: `0x${'22'.repeat(20)}`,
	router: `0x${'33'.repeat(20)}`,
	feeBps: 30,
}

function QuestionClockProbe({ endTime, services }: { endTime: bigint | undefined; services: LiveTradingControllerServices }) {
	const nowSeconds = useQuestionClock(endTime, configuration, services)
	return h('output', null, nowSeconds.toString())
}

function servicesWithBlockTimestamp(timestamp: bigint, calls: { count: number }): LiveTradingControllerServices {
	const client = createPublicClient({
		transport: custom({
			request: async ({ method }) => {
				if (method !== 'eth_getBlockByNumber') throw new Error(`Unexpected RPC method ${method}`)
				calls.count += 1
				return { hash: `0x${'11'.repeat(32)}`, number: '0x2', parentHash: `0x${'22'.repeat(32)}`, timestamp: `0x${timestamp.toString(16)}`, transactions: [] }
			},
		}),
	})
	return { ...liveTradingControllerServices, createTradingPublicClient: () => client }
}

// Records the 12-second chain polls the clock schedules without ever firing them.
function trackQuestionClockTimers(scheduled: number[]) {
	const originalSetTimeout = globalThis.setTimeout
	return spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...parameters) => {
		if (delay === 12_000) {
			scheduled.push(delay)
			return originalSetTimeout(() => undefined, 0)
		}
		return originalSetTimeout(handler, delay, ...parameters)
	})
}

describe('question clock', () => {
	const lifecycle = installDomTestLifecycle()

	test('starts from the wall clock and keeps polling while the question is still open', async () => {
		const before = BigInt(Math.floor(Date.now() / 1_000))
		const calls = { count: 0 }
		const scheduled: number[] = []
		const timers = trackQuestionClockTimers(scheduled)
		try {
			const rendered = lifecycle.trackRendered(await renderIntoDocument(h(QuestionClockProbe, { endTime: 200n, services: servicesWithBlockTimestamp(150n, calls) })))
			const initial = BigInt(rendered.container.textContent ?? '')
			expect(initial).toBeGreaterThanOrEqual(before)
			await waitFor(() => expect(rendered.container.textContent).toBe('150'))
			expect(calls.count).toBe(1)
			expect(scheduled).toEqual([12_000])
		} finally {
			timers.mockRestore()
		}
	})

	test('stops polling the chain clock once the block timestamp reaches the question end', async () => {
		const calls = { count: 0 }
		const scheduled: number[] = []
		const timers = trackQuestionClockTimers(scheduled)
		try {
			const rendered = lifecycle.trackRendered(await renderIntoDocument(h(QuestionClockProbe, { endTime: 200n, services: servicesWithBlockTimestamp(200n, calls) })))
			await waitFor(() => expect(rendered.container.textContent).toBe('200'))
			expect(calls.count).toBe(1)
			expect(scheduled).toEqual([])
		} finally {
			timers.mockRestore()
		}
	})
})

describe('probability bar', () => {
	installDomTestLifecycle()

	test('rounds the displayed conditional prices so YES and NO stay complementary', async () => {
		for (const [yesPercent, yes, no] of [
			[70.25, '70.3', '29.7'],
			[50.05, '50.1', '49.9'],
		] as const) {
			const rendered = await renderIntoDocument(h(ProbabilityBar, { yesPercent }))
			try {
				const labels = [...rendered.container.querySelectorAll('.probability__labels span')].map(label => label.textContent)
				expect(labels).toEqual([`Conditional YES ${yes}%`, `Conditional NO ${no}%`])
			} finally {
				await rendered.cleanup()
			}
		}
	})
})
