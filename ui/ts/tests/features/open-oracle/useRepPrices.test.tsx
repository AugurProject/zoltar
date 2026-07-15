/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, waitFor, within } from '../../testUtils/queries'
import type { Address } from '@zoltar/shared/ethereum'
import { createPublicClient, http } from '@zoltar/shared/ethereum'
import type { SimulationController } from '../../../simulation/controller.js'
import { resetRepPriceCacheForTesting, useRepPrices } from '../../../features/open-oracle/hooks/useRepPrices.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import type { ChainBackend, ReadClient } from '../../../lib/chainBackend.js'
import { createFakeBackend, createFakeSimulationProfile } from '../../testUtils/fakeBackend.js'
import { serializeSavedSimulationStateEnvelope } from '../../../simulation/savedStates.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

function createSimulationController(): SimulationController {
	const selectedAccount = '0x00000000000000000000000000000000000000a1' as Address

	return {
		accounts: [],
		advanceTime: async () => undefined,
		bootstrapError: undefined,
		bootstrapLabel: undefined,
		bootstrapProgress: undefined,
		blockCountSinceReset: 0n,
		currentTimestamp: 0n,
		currentScenario: 'baseline',
		dispose: async () => undefined,
		exportState: async name =>
			serializeSavedSimulationStateEnvelope({
				baseScenario: 'baseline',
				name,
				savedAt: '2026-06-02T12:34:56.000Z',
				state: {
					blockCountSinceReset: 0n,
					currentTimestamp: 0n,
					queryDelayMilliseconds: 0,
					repPerEthPrice: 10n ** 18n,
					repPerUsdcPrice: 10n ** 6n,
					selectedAccount,
					snapshot: {},
					transactionCountSinceReset: 0n,
					transactionDelayMilliseconds: 0,
				},
				version: 1,
			}),
		isActive: true,
		isBootstrapped: true,
		isBootstrapping: false,
		mintRep: async () => undefined,
		mineBlock: async () => undefined,
		queryDelayMilliseconds: 0,
		repPerEthPrice: 10n ** 18n,
		repPerUsdcPrice: 10n ** 6n,
		reset: async () => undefined,
		selectAccount: async () => undefined,
		selectedAccount,
		simulationSource: {
			kind: 'scenario',
			scenario: 'baseline',
		},
		setRepPerEthPrice: () => undefined,
		setRepPerUsdcPrice: () => undefined,
		setQueryDelayMilliseconds: () => undefined,
		subscribe: () => () => undefined,
		transactionCountSinceReset: 0n,
		transactionDelayMilliseconds: 0,
		setTransactionDelayMilliseconds: () => undefined,
		waitUntilReady: async () => undefined,
	}
}

function PriceProbe({ enabled = true }: { enabled?: boolean }) {
	const { isLoadingRepPrices, isRefreshingRepPrices, repPerEthPrice, refreshRepPrices, repUsdcPrice } = useRepPrices({ enabled })

	return (
		<div>
			<span data-testid='rep-per-eth'>{repPerEthPrice?.toString() ?? '-'}</span>
			<span data-testid='rep-per-usdc'>{repUsdcPrice?.toString() ?? '-'}</span>
			<span data-testid='rep-loading'>{isLoadingRepPrices ? 'loading' : 'ready'}</span>
			<span data-testid='rep-refreshing'>{isRefreshingRepPrices ? 'refreshing' : 'idle'}</span>
			<button type='button' onClick={refreshRepPrices}>
				Refresh REP prices
			</button>
		</div>
	)
}

describe('useRepPrices', () => {
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
		resetRepPriceCacheForTesting()
		resetActiveEnvironmentForTesting()
	})

	test('loads simulation mock REP prices using the active profile REP token', async () => {
		const profile = createFakeSimulationProfile()
		const readClient: ReadClient = {
			...createPublicClient({
				chain: profile.chain,
				transport: http('http://127.0.0.1:8545'),
			}),
		}
		readClient.readContract = async () => 'REP' as never
		readClient.simulateContract = async () => {
			throw new Error('Simulation mock pricing should not hit the onchain quoter')
		}
		const backend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => readClient,
		}

		const resetEnvironment = installActiveEnvironmentForTesting(backend, createSimulationController())

		const renderedComponent = await renderIntoDocument(<PriceProbe />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
			expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe((10n ** 6n).toString())
			expect(documentQueries.getByTestId('rep-loading').textContent).toBe('ready')
			expect(documentQueries.getByTestId('rep-refreshing').textContent).toBe('idle')
		})
		resetEnvironment()
	})

	test('reuses cached prices for 30 seconds without refetching', async () => {
		const profile = createFakeSimulationProfile()
		let readContractCount = 0
		const readClient: ReadClient = {
			...createPublicClient({
				chain: profile.chain,
				transport: http('http://127.0.0.1:8545'),
			}),
		}
		readClient.readContract = async () => {
			readContractCount += 1
			return 'REP' as never
		}
		readClient.simulateContract = async () => {
			throw new Error('Simulation mock pricing should not hit the onchain quoter')
		}
		const backend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => readClient,
		}

		const resetEnvironment = installActiveEnvironmentForTesting(backend, createSimulationController())

		const firstRender = await renderIntoDocument(<PriceProbe />)
		cleanupRenderedComponent = firstRender.cleanup

		const firstQueries = within(document.body)
		await waitFor(() => {
			expect(firstQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
			expect(firstQueries.getByTestId('rep-per-usdc').textContent).toBe((10n ** 6n).toString())
		})
		expect(readContractCount).toBe(2)

		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const secondRender = await renderIntoDocument(<PriceProbe />)
		cleanupRenderedComponent = secondRender.cleanup

		const secondQueries = within(document.body)
		expect(secondQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
		expect(secondQueries.getByTestId('rep-per-usdc').textContent).toBe((10n ** 6n).toString())
		expect(secondQueries.getByTestId('rep-loading').textContent).toBe('ready')
		expect(secondQueries.getByTestId('rep-refreshing').textContent).toBe('idle')
		expect(readContractCount).toBe(2)

		resetEnvironment()
	})

	test('keeps cached prices visible while a stale cache refreshes in the background', async () => {
		const profile = createFakeSimulationProfile()
		const simulationController = createSimulationController()
		let readDelayMilliseconds = 0
		const readClient: ReadClient = {
			...createPublicClient({
				chain: profile.chain,
				transport: http('http://127.0.0.1:8545'),
			}),
		}
		readClient.readContract = async () => {
			if (readDelayMilliseconds > 0) await new Promise(resolve => setTimeout(resolve, readDelayMilliseconds))
			return 'REP' as never
		}
		readClient.simulateContract = async () => {
			throw new Error('Simulation mock pricing should not hit the onchain quoter')
		}
		const backend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => readClient,
		}

		const resetEnvironment = installActiveEnvironmentForTesting(backend, simulationController)

		const firstRender = await renderIntoDocument(<PriceProbe />)
		cleanupRenderedComponent = firstRender.cleanup

		const initialQueries = within(document.body)
		await waitFor(() => {
			expect(initialQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
			expect(initialQueries.getByTestId('rep-per-usdc').textContent).toBe((10n ** 6n).toString())
		})

		const originalDateNow = Date.now
		const cachedAtMs = originalDateNow()

		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		simulationController.repPerEthPrice = 2n * 10n ** 18n
		simulationController.repPerUsdcPrice = 2n * 10n ** 6n
		readDelayMilliseconds = 50
		Reflect.set(Date, 'now', () => cachedAtMs + 31_000)

		try {
			const secondRender = await renderIntoDocument(<PriceProbe />)
			cleanupRenderedComponent = secondRender.cleanup

			const secondQueries = within(document.body)
			expect(secondQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
			expect(secondQueries.getByTestId('rep-per-usdc').textContent).toBe((10n ** 6n).toString())
			expect(secondQueries.getByTestId('rep-loading').textContent).toBe('ready')
			expect(secondQueries.getByTestId('rep-refreshing').textContent).toBe('refreshing')

			await waitFor(() => {
				expect(secondQueries.getByTestId('rep-per-eth').textContent).toBe((2n * 10n ** 18n).toString())
				expect(secondQueries.getByTestId('rep-per-usdc').textContent).toBe((2n * 10n ** 6n).toString())
				expect(secondQueries.getByTestId('rep-refreshing').textContent).toBe('idle')
			})
		} finally {
			Reflect.set(Date, 'now', originalDateNow)
		}

		resetEnvironment()
	})

	test('manual refresh bypasses the 30 second cache window', async () => {
		const profile = createFakeSimulationProfile()
		const simulationController = createSimulationController()
		let readContractCount = 0
		let readDelayMilliseconds = 0
		const readClient: ReadClient = {
			...createPublicClient({
				chain: profile.chain,
				transport: http('http://127.0.0.1:8545'),
			}),
		}
		readClient.readContract = async () => {
			readContractCount += 1
			if (readDelayMilliseconds > 0) await new Promise(resolve => setTimeout(resolve, readDelayMilliseconds))
			return 'REP' as never
		}
		readClient.simulateContract = async () => {
			throw new Error('Simulation mock pricing should not hit the onchain quoter')
		}
		const backend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => readClient,
		}

		const resetEnvironment = installActiveEnvironmentForTesting(backend, simulationController)

		const renderedComponent = await renderIntoDocument(<PriceProbe />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
			expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe((10n ** 6n).toString())
		})
		expect(readContractCount).toBe(2)

		simulationController.repPerEthPrice = 3n * 10n ** 18n
		simulationController.repPerUsdcPrice = 3n * 10n ** 6n
		readDelayMilliseconds = 50

		fireEvent.click(documentQueries.getByRole('button', { name: 'Refresh REP prices' }))

		expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
		expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe((10n ** 6n).toString())

		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-loading').textContent).toBe('ready')
			expect(documentQueries.getByTestId('rep-refreshing').textContent).toBe('refreshing')
		})

		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((3n * 10n ** 18n).toString())
			expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe((3n * 10n ** 6n).toString())
			expect(documentQueries.getByTestId('rep-refreshing').textContent).toBe('idle')
		})
		expect(readContractCount).toBe(4)

		resetEnvironment()
	})

	test('disabled mode skips the initial fetch until the user refreshes manually', async () => {
		const profile = createFakeSimulationProfile()
		const simulationController = createSimulationController()
		let readContractCount = 0
		const readClient: ReadClient = {
			...createPublicClient({
				chain: profile.chain,
				transport: http('http://127.0.0.1:8545'),
			}),
		}
		readClient.readContract = async () => {
			readContractCount += 1
			return 'REP' as never
		}
		readClient.simulateContract = async () => {
			throw new Error('Simulation mock pricing should not hit the onchain quoter')
		}
		const backend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => readClient,
		}

		const resetEnvironment = installActiveEnvironmentForTesting(backend, simulationController)

		const renderedComponent = await renderIntoDocument(<PriceProbe enabled={false} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe('-')
		expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe('-')
		expect(documentQueries.getByTestId('rep-loading').textContent).toBe('ready')
		expect(documentQueries.getByTestId('rep-refreshing').textContent).toBe('idle')
		expect(readContractCount).toBe(0)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Refresh REP prices' }))

		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
			expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe((10n ** 6n).toString())
		})
		expect(readContractCount).toBe(2)

		resetEnvironment()
	})

	test('disabled mode shows cached prices without starting another background refresh', async () => {
		const profile = createFakeSimulationProfile()
		let readContractCount = 0
		const readClient: ReadClient = {
			...createPublicClient({
				chain: profile.chain,
				transport: http('http://127.0.0.1:8545'),
			}),
		}
		readClient.readContract = async () => {
			readContractCount += 1
			return 'REP' as never
		}
		readClient.simulateContract = async () => {
			throw new Error('Simulation mock pricing should not hit the onchain quoter')
		}
		const backend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => readClient,
		}

		const resetEnvironment = installActiveEnvironmentForTesting(backend, createSimulationController())

		const firstRender = await renderIntoDocument(<PriceProbe />)
		cleanupRenderedComponent = firstRender.cleanup

		const firstQueries = within(document.body)
		await waitFor(() => {
			expect(firstQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
			expect(firstQueries.getByTestId('rep-per-usdc').textContent).toBe((10n ** 6n).toString())
		})
		expect(readContractCount).toBe(2)

		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const secondRender = await renderIntoDocument(<PriceProbe enabled={false} />)
		cleanupRenderedComponent = secondRender.cleanup

		const secondQueries = within(document.body)
		expect(secondQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
		expect(secondQueries.getByTestId('rep-per-usdc').textContent).toBe((10n ** 6n).toString())
		expect(secondQueries.getByTestId('rep-loading').textContent).toBe('ready')
		expect(secondQueries.getByTestId('rep-refreshing').textContent).toBe('idle')
		expect(readContractCount).toBe(2)

		resetEnvironment()
	})
})
