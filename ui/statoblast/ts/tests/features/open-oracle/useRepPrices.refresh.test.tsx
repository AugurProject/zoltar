/// <reference types="bun-types" />

import { createPublicClient, getAddress, http } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installRepPriceQuoterForTesting } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js'
import { describe, expect, mock, spyOn, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { createRepPriceProbe, readRepPriceProbe } from './repPriceProbe.js'

type UseRepPrices = typeof import('@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js')['useRepPrices']
type RepQuote = { amountOut: bigint; source: { label: 'MOCK'; poolUrl: undefined; protocol: 'mock' } }

function mockQuote(amountOut: bigint): RepQuote {
	return { amountOut, source: { label: 'MOCK', poolUrl: undefined, protocol: 'mock' } }
}

function createRejectingV3Quote() {
	return mock(async () => {
		throw new Error('quoteBestV3ExactInputWithSource should not be called in this test')
	})
}

function expectPrices(repPerEth: string, repPerUsdc: string) {
	const probe = readRepPriceProbe()
	expect(probe.repPerEth).toBe(repPerEth)
	expect(probe.repPerUsdc).toBe(repPerUsdc)
}

const clickRefresh = () => fireEvent.click(within(document.body).getByRole('button', { name: 'Refresh REP prices' }))

describe('useRepPrices refresh races', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			mock.restore()
			installRepPriceQuoterForTesting(undefined)
			resetActiveEnvironmentForTesting()
		},
	})

	/** Installs a fake backend and renders a probe over `useRepPrices`, by default from a fresh module with an empty cache. */
	async function renderRepPrices(importSuffix = `?case=${crypto.randomUUID()}`) {
		installActiveEnvironmentForTesting({ ...createFakeBackend(), createReadClient: () => createPublicClient({ transport: http('http://127.0.0.1:8545') }) })
		const { useRepPrices }: { useRepPrices: UseRepPrices } = await import(`@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js${importSuffix}`)
		const Probe = createRepPriceProbe(useRepPrices)
		const mount = async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = (await renderIntoDocument(<Probe />)).cleanup
		}
		await mount()
		return { remount: mount }
	}

	test('times out stalled price quotes and allows a fresh retry without applying late results', async () => {
		const originalSetTimeout = globalThis.setTimeout
		spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => originalSetTimeout(handler, delay === 30_000 ? 10 : delay, ...args))
		const stalled = createDeferred<RepQuote>()
		let ethCalls = 0
		const quote = mockQuote(3n)
		installRepPriceQuoterForTesting({
			getRepAddress: () => getAddress('0x00000000000000000000000000000000000000e1'),
			isRepPricingEnabled: () => true,
			quoteBestExactInputWithSource: async () => (++ethCalls === 1 ? await stalled.promise : quote),
			quoteBestV3ExactInputWithSource: async () => quote,
			quoteRepForUsdcV4WithSource: async () => quote,
		})
		await renderRepPrices('')
		await waitFor(() => expect(readRepPriceProbe().ethFailure).toBe('rpc-error'))
		expect(readRepPriceProbe().loading).toBe('ready')
		expect(readRepPriceProbe().repPerUsdc).toBe('3')
		await act(() => clickRefresh())
		await waitFor(() => expect(readRepPriceProbe().repPerEth).toBe('3'))
		await act(async () => {
			stalled.resolve({ ...quote, amountOut: 99n })
			await stalled.promise
		})
		expect(readRepPriceProbe().repPerEth).toBe('3')
	})

	test('keeps the newest REP price refresh when overlapping requests resolve out of order', async () => {
		const oldEthQuote = createDeferred<RepQuote>()
		const oldUsdcQuote = createDeferred<RepQuote>()
		const newEthQuote = createDeferred<RepQuote>()
		const newUsdcQuote = createDeferred<RepQuote>()
		let ethCallCount = 0
		let usdcCallCount = 0

		installRepPriceQuoterForTesting({
			getRepAddress: () => getAddress('0x00000000000000000000000000000000000000e1'),
			isRepPricingEnabled: () => true,
			quoteBestExactInputWithSource: mock(async () => {
				ethCallCount += 1
				if (ethCallCount === 1) return mockQuote(1n)
				if (ethCallCount === 2) return await oldEthQuote.promise
				if (ethCallCount === 3) return await newEthQuote.promise
				throw new Error('Unexpected REP/ETH quote call')
			}),
			quoteBestV3ExactInputWithSource: createRejectingV3Quote(),
			quoteRepForUsdcV4WithSource: mock(async () => {
				usdcCallCount += 1
				if (usdcCallCount === 1) return mockQuote(10n)
				if (usdcCallCount === 2) return await oldUsdcQuote.promise
				if (usdcCallCount === 3) return await newUsdcQuote.promise
				throw new Error('Unexpected REP/USDC quote call')
			}),
		})
		const repPrices = await renderRepPrices()

		await waitFor(() => expectPrices('1', '10'))

		await act(async () => {
			clickRefresh()
			clickRefresh()
		})

		await waitFor(() => {
			expect(ethCallCount).toBe(3)
			expect(usdcCallCount).toBe(3)
		})

		await act(async () => {
			newEthQuote.resolve(mockQuote(3n))
			newUsdcQuote.resolve(mockQuote(30n))
			await Promise.all([newEthQuote.promise, newUsdcQuote.promise])
		})

		await waitFor(() => expectPrices('3', '30'))

		await act(async () => {
			oldEthQuote.resolve(mockQuote(2n))
			oldUsdcQuote.resolve(mockQuote(20n))
			await Promise.all([oldEthQuote.promise, oldUsdcQuote.promise])
		})

		expectPrices('3', '30')

		await repPrices.remount()

		await waitFor(() => expectPrices('3', '30'))
	})

	test('does not renew a failed quote when the other quote refreshes successfully', async () => {
		let ethCallCount = 0
		let usdcCallCount = 0
		installRepPriceQuoterForTesting({
			getRepAddress: () => getAddress('0x00000000000000000000000000000000000000e2'),
			isRepPricingEnabled: () => true,
			quoteBestExactInputWithSource: mock(async () => {
				ethCallCount += 1
				return mockQuote(BigInt(ethCallCount))
			}),
			quoteBestV3ExactInputWithSource: createRejectingV3Quote(),
			quoteRepForUsdcV4WithSource: mock(async () => {
				usdcCallCount += 1
				if (usdcCallCount === 1) return mockQuote(10n)
				throw new Error('No pool is available for the REP/USDC quote')
			}),
		})
		await renderRepPrices()

		await waitFor(() => expectPrices('1', '10'))
		clickRefresh()

		await waitFor(() => {
			expectPrices('2', '-')
			expect(readRepPriceProbe().usdcFailure).toBe('no-liquidity')
		})
	})
})
