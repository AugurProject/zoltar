/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries'
import type { Address } from '@zoltar/shared/ethereum'
import { createPublicClient, http } from '@zoltar/shared/ethereum'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import type { SimulationController } from '@zoltar/ui-core-shared/simulation/controller.js'
import { resetRepPriceCacheForTesting, useRepPrices } from '../../../features/open-oracle/hooks/useRepPrices.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { ChainBackend, ReadClient } from '@zoltar/ui-core-shared/lib/chainBackend.js'
import { createFakeBackend, createFakeSimulationProfile } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { serializeSavedSimulationStateEnvelope } from '@zoltar/ui-core-shared/simulation/savedStates.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

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
		setRepPerEthPrice: async () => undefined,
		setRepPerUsdcPrice: async () => undefined,
		setQueryDelayMilliseconds: async () => undefined,
		subscribe: () => () => undefined,
		transactionCountSinceReset: 0n,
		transactionDelayMilliseconds: 0,
		setTransactionDelayMilliseconds: async () => undefined,
		waitUntilReady: async () => undefined,
	}
}

function PriceProbe({ captureRefresh, enabled = true }: { captureRefresh?: (refresh: () => void) => void; enabled?: boolean; renderKey?: string }) {
	const { isLoadingRepPrices, isRefreshingRepPrices, repPerEthFailure, repPerEthPrice, refreshRepPrices, repUsdcFailure, repUsdcPrice } = useRepPrices({ enabled })
	captureRefresh?.(refreshRepPrices)

	return (
		<div>
			<span data-testid='rep-per-eth'>{repPerEthPrice?.toString() ?? '-'}</span>
			<span data-testid='rep-per-eth-failure'>{repPerEthFailure ?? '-'}</span>
			<span data-testid='rep-per-usdc'>{repUsdcPrice?.toString() ?? '-'}</span>
			<span data-testid='rep-per-usdc-failure'>{repUsdcFailure ?? '-'}</span>
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

	test('reports missing Sepolia liquidity after the automatic quote attempt', async () => {
		const readClient: ReadClient = {
			...createPublicClient({
				chain: SEPOLIA_NETWORK_PROFILE.chain,
				transport: http('http://127.0.0.1:8545'),
			}),
		}
		readClient.simulateContract = async () => {
			throw new Error('No Uniswap pool is available')
		}
		const backend: ChainBackend = {
			...createFakeBackend({ profile: SEPOLIA_NETWORK_PROFILE }),
			createReadClient: () => readClient,
		}
		const resetEnvironment = installActiveEnvironmentForTesting(backend)

		const renderedComponent = await renderIntoDocument(<PriceProbe />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth-failure').textContent).toBe('no-liquidity')
			expect(documentQueries.getByTestId('rep-per-usdc-failure').textContent).toBe('no-liquidity')
			expect(documentQueries.getByTestId('rep-loading').textContent).toBe('ready')
		})
		resetEnvironment()
	})

	test('reports Sepolia RPC failures separately from missing liquidity', async () => {
		const rpcError = new Error('RPC request failed')
		rpcError.name = 'RpcRequestError'
		const readClient: ReadClient = {
			...createPublicClient({
				chain: SEPOLIA_NETWORK_PROFILE.chain,
				transport: http('http://127.0.0.1:8545'),
			}),
		}
		readClient.simulateContract = async () => {
			throw rpcError
		}
		const backend: ChainBackend = {
			...createFakeBackend({ profile: SEPOLIA_NETWORK_PROFILE }),
			createReadClient: () => readClient,
		}
		const resetEnvironment = installActiveEnvironmentForTesting(backend)

		const renderedComponent = await renderIntoDocument(<PriceProbe />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth-failure').textContent).toBe('rpc-error')
			expect(documentQueries.getByTestId('rep-per-usdc-failure').textContent).toBe('rpc-error')
			expect(documentQueries.getByTestId('rep-loading').textContent).toBe('ready')
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

	test('removes expired cached prices while refreshing them in the background', async () => {
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
			expect(secondQueries.getByTestId('rep-per-eth').textContent).toBe('-')
			expect(secondQueries.getByTestId('rep-per-usdc').textContent).toBe('-')
			expect(secondQueries.getByTestId('rep-loading').textContent).toBe('loading')
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

	test('automatically expires and refreshes prices in a long-lived view', async () => {
		const originalSetTimeout = window.setTimeout
		let expiryCallback: (() => void) | undefined
		window.setTimeout = ((handler: TimerHandler, timeout = 0) => {
			if (typeof handler === 'function' && timeout >= 29_000) {
				expiryCallback = handler as () => void
				return 987_654
			}
			return originalSetTimeout(handler, timeout)
		}) as typeof window.setTimeout
		try {
			const profile = createFakeSimulationProfile()
			const simulationController = createSimulationController()
			let readDelayMilliseconds = 0
			const readClient: ReadClient = {
				...createPublicClient({ chain: profile.chain, transport: http('http://127.0.0.1:8545') }),
			}
			readClient.readContract = async () => {
				if (readDelayMilliseconds > 0) await new Promise(resolve => originalSetTimeout(resolve, readDelayMilliseconds))
				return 'REP' as never
			}
			readClient.simulateContract = async () => {
				throw new Error('Simulation mock pricing should not hit the onchain quoter')
			}
			const backend: ChainBackend = {
				...createFakeBackend({ profile }),
				createReadClient: () => readClient,
			}
			installActiveEnvironmentForTesting(backend, simulationController)

			const renderedComponent = await renderIntoDocument(<PriceProbe />)
			cleanupRenderedComponent = renderedComponent.cleanup
			const documentQueries = within(document.body)
			await waitFor(() => {
				expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
				expect(expiryCallback).toBeDefined()
			})

			simulationController.repPerEthPrice = 2n * 10n ** 18n
			simulationController.repPerUsdcPrice = 2n * 10n ** 6n
			readDelayMilliseconds = 50
			const runExpiry = expiryCallback
			if (runExpiry === undefined) throw new Error('Expected REP price expiry callback')
			await act(() => {
				runExpiry()
			})
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe('-')
			expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe('-')

			await waitFor(() => {
				expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((2n * 10n ** 18n).toString())
				expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe((2n * 10n ** 6n).toString())
			})
		} finally {
			window.setTimeout = originalSetTimeout
		}
	})

	test('does not expose prices from the previous backend while a new backend loads', async () => {
		const profile = createFakeSimulationProfile()
		const firstController = createSimulationController()
		const firstReadClient: ReadClient = {
			...createPublicClient({ chain: profile.chain, transport: http('http://127.0.0.1:8545') }),
		}
		firstReadClient.readContract = async () => 'REP' as never
		firstReadClient.simulateContract = async () => {
			throw new Error('Simulation mock pricing should not hit the onchain quoter')
		}
		const firstBackend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => firstReadClient,
		}
		installActiveEnvironmentForTesting(firstBackend, firstController)

		const renderedComponent = await renderIntoDocument(<PriceProbe />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
		})

		const secondController = createSimulationController()
		secondController.repPerEthPrice = 2n * 10n ** 18n
		secondController.repPerUsdcPrice = 2n * 10n ** 6n
		const secondReadClient: ReadClient = {
			...createPublicClient({ chain: profile.chain, transport: http('http://127.0.0.1:8545') }),
		}
		secondReadClient.readContract = async () => {
			await new Promise(resolve => setTimeout(resolve, 50))
			return 'REP' as never
		}
		secondReadClient.simulateContract = firstReadClient.simulateContract
		const secondBackend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => secondReadClient,
		}
		installActiveEnvironmentForTesting(secondBackend, secondController)

		await act(() => {
			render(<PriceProbe renderKey='second-backend' />, renderedComponent.container)
		})
		expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe('-')
		expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe('-')

		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((2n * 10n ** 18n).toString())
			expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe((2n * 10n ** 6n).toString())
		})
	})

	test('ignores a saved refresh callback from the previous backend', async () => {
		const profile = createFakeSimulationProfile()
		const firstController = createSimulationController()
		const firstReadClient: ReadClient = {
			...createPublicClient({ chain: profile.chain, transport: http('http://127.0.0.1:8545') }),
		}
		firstReadClient.readContract = async () => 'REP' as never
		firstReadClient.simulateContract = async () => {
			throw new Error('Simulation mock pricing should not hit the onchain quoter')
		}
		const firstBackend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => firstReadClient,
		}
		installActiveEnvironmentForTesting(firstBackend, firstController)

		let savedFirstRefresh: (() => void) | undefined
		const renderedComponent = await renderIntoDocument(<PriceProbe captureRefresh={refresh => (savedFirstRefresh ??= refresh)} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
		})

		const secondController = createSimulationController()
		secondController.repPerEthPrice = 2n * 10n ** 18n
		secondController.repPerUsdcPrice = 2n * 10n ** 6n
		let releaseSecondReads: (() => void) | undefined
		const secondReadsReleased = new Promise<void>(resolve => {
			releaseSecondReads = resolve
		})
		let secondReadCount = 0
		const secondReadClient: ReadClient = {
			...createPublicClient({ chain: profile.chain, transport: http('http://127.0.0.1:8545') }),
		}
		secondReadClient.readContract = async () => {
			secondReadCount += 1
			await secondReadsReleased
			return 'REP' as never
		}
		secondReadClient.simulateContract = firstReadClient.simulateContract
		const secondBackend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => secondReadClient,
		}
		installActiveEnvironmentForTesting(secondBackend, secondController)

		await act(() => {
			render(<PriceProbe captureRefresh={refresh => (savedFirstRefresh ??= refresh)} renderKey='second-backend' />, renderedComponent.container)
		})
		await waitFor(() => {
			expect(secondReadCount).toBeGreaterThan(0)
		})

		if (savedFirstRefresh === undefined) throw new Error('Expected the first backend refresh callback')
		const firstRefresh = savedFirstRefresh
		await act(() => {
			firstRefresh()
		})
		if (releaseSecondReads === undefined) throw new Error('Expected the second backend reads to be pending')
		releaseSecondReads()

		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((2n * 10n ** 18n).toString())
			expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe((2n * 10n ** 6n).toString())
		})
	})

	test('clears cached prices and exposes failures when a refresh cannot quote', async () => {
		const profile = createFakeSimulationProfile()
		let failReads = false
		const readClient: ReadClient = {
			...createPublicClient({ chain: profile.chain, transport: http('http://127.0.0.1:8545') }),
		}
		readClient.readContract = async () => {
			if (failReads) {
				const error = new Error('RPC request failed')
				error.name = 'RpcRequestError'
				throw error
			}
			return 'REP' as never
		}
		readClient.simulateContract = async () => {
			if (failReads) {
				const error = new Error('RPC request failed')
				error.name = 'RpcRequestError'
				throw error
			}
			throw new Error('Simulation mock pricing should not hit the onchain quoter')
		}
		const backend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => readClient,
		}
		installActiveEnvironmentForTesting(backend, createSimulationController())

		const renderedComponent = await renderIntoDocument(<PriceProbe />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
		})

		failReads = true
		fireEvent.click(documentQueries.getByRole('button', { name: 'Refresh REP prices' }))
		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe('-')
			expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe('-')
			expect(documentQueries.getByTestId('rep-per-eth-failure').textContent).not.toBe('-')
			expect(documentQueries.getByTestId('rep-per-usdc-failure').textContent).not.toBe('-')
		})
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
