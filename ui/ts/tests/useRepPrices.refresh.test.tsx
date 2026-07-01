/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress } from 'viem'
import { fireEvent, waitFor, within } from './testUtils/queries'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type UseRepPrices = typeof import('../hooks/useRepPrices.js')['useRepPrices']

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createHarness(useRepPrices: UseRepPrices) {
	return function RepPricesHarness() {
		const { repPerEthPrice, repUsdcPrice, refreshRepPrices } = useRepPrices()

		return (
			<div>
				<button onClick={refreshRepPrices} type='button'>
					Refresh
				</button>
				<span data-testid='rep-per-eth'>{repPerEthPrice?.toString() ?? '-'}</span>
				<span data-testid='rep-per-usdc'>{repUsdcPrice?.toString() ?? '-'}</span>
			</div>
		)
	}
}

describe('useRepPrices refresh races', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
		resetActiveEnvironmentForTesting()
	})

	test('keeps the newest REP price refresh when overlapping requests resolve out of order', async () => {
		const repAddress = getAddress('0x00000000000000000000000000000000000000e1')
		const oldEthQuote = createDeferred<{ amountOut: bigint; source: { poolUrl: string | undefined; protocol: 'mock' } }>()
		const oldUsdcQuote = createDeferred<{ amountOut: bigint; source: { poolUrl: string | undefined; protocol: 'mock' } }>()
		const newEthQuote = createDeferred<{ amountOut: bigint; source: { poolUrl: string | undefined; protocol: 'mock' } }>()
		const newUsdcQuote = createDeferred<{ amountOut: bigint; source: { poolUrl: string | undefined; protocol: 'mock' } }>()
		let ethCallCount = 0
		let usdcCallCount = 0

		mock.module('../lib/uniswapQuoter.js', () => ({
			ETH_ADDRESS: getAddress('0x00000000000000000000000000000000000000f1'),
			getRepAddress: () => repAddress,
			isRepPricingEnabled: () => true,
			quoteBestExactInputWithSource: mock(async () => {
				ethCallCount += 1
				if (ethCallCount === 1) return { amountOut: 1n, source: { poolUrl: undefined, protocol: 'mock' as const } }
				if (ethCallCount === 2) return await oldEthQuote.promise
				if (ethCallCount === 3) return await newEthQuote.promise
				throw new Error('Unexpected REP/ETH quote call')
			}),
			quoteBestV3ExactInputWithSource: mock(async () => {
				throw new Error('quoteBestV3ExactInputWithSource should not be called in this test')
			}),
			quoteRepForUsdcV4WithSource: mock(async () => {
				usdcCallCount += 1
				if (usdcCallCount === 1) return { amountOut: 10n, source: { poolUrl: undefined, protocol: 'mock' as const } }
				if (usdcCallCount === 2) return await oldUsdcQuote.promise
				if (usdcCallCount === 3) return await newUsdcQuote.promise
				throw new Error('Unexpected REP/USDC quote call')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
		}))

		installActiveEnvironmentForTesting(createFakeBackend())
		const { useRepPrices } = await import(`../hooks/useRepPrices.js?case=${crypto.randomUUID()}`)
		const Harness = createHarness(useRepPrices)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe('1')
			expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe('10')
		})

		const refreshButton = documentQueries.getByRole('button', { name: 'Refresh' })

		await act(async () => {
			fireEvent.click(refreshButton)
			fireEvent.click(refreshButton)
		})

		await waitFor(() => {
			expect(ethCallCount).toBe(3)
			expect(usdcCallCount).toBe(3)
		})

		await act(async () => {
			newEthQuote.resolve({ amountOut: 3n, source: { poolUrl: undefined, protocol: 'mock' } })
			newUsdcQuote.resolve({ amountOut: 30n, source: { poolUrl: undefined, protocol: 'mock' } })
			await Promise.all([newEthQuote.promise, newUsdcQuote.promise])
		})

		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe('3')
			expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe('30')
		})

		await act(async () => {
			oldEthQuote.resolve({ amountOut: 2n, source: { poolUrl: undefined, protocol: 'mock' } })
			oldUsdcQuote.resolve({ amountOut: 20n, source: { poolUrl: undefined, protocol: 'mock' } })
			await Promise.all([oldEthQuote.promise, oldUsdcQuote.promise])
		})

		expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe('3')
		expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe('30')
	})
})
