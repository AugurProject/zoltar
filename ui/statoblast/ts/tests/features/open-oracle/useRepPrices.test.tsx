/// <reference types="bun-types" />

import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { createPublicClient, http } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { SimulationController } from '@zoltar/ui-core-shared/simulation/controller.js'
import { serializeSavedSimulationStateEnvelope } from '@zoltar/ui-core-shared/simulation/savedStates.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend, createFakeSimulationProfile } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { ChainBackend, ReadClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { resetRepPriceCacheForTesting, useRepPrices } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js'
import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { createRepPriceProbe, readRepPriceProbe } from './repPriceProbe.js'

const PriceProbe = createRepPriceProbe(useRepPrices)
const REP_PER_ETH = 10n ** 18n
const REP_PER_USDC = 10n ** 6n

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
					repPerEthPrice: REP_PER_ETH,
					repPerUsdcPrice: REP_PER_USDC,
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
		advanceBlock: async () => undefined,
		queryDelayMilliseconds: 0,
		repPerEthPrice: REP_PER_ETH,
		repPerUsdcPrice: REP_PER_USDC,
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
		setWalletMode: async () => undefined,
		walletMode: 'connected',
		waitUntilReady: async () => undefined,
	}
}

function createRpcError() {
	const error = new Error('RPC request failed')
	error.name = 'RpcRequestError'
	return error
}

const rejectOnchainQuote = async (): Promise<never> => {
	throw new Error('Simulation mock pricing should not hit the onchain quoter')
}

/** A read client for `profile` whose reads and simulations default to the simulation mock-pricing path. */
function createReadClient(options: { profile?: ChainBackend['profile']; readContract?: () => Promise<unknown>; simulateContract?: () => Promise<never> } = {}): ReadClient {
	const readClient: ReadClient = {
		...createPublicClient({ chain: (options.profile ?? createFakeSimulationProfile()).chain, transport: http('http://127.0.0.1:8545') }),
	}
	const readContract = options.readContract ?? (async () => 'REP')
	readClient.readContract = async () => (await readContract()) as never
	readClient.simulateContract = options.simulateContract ?? rejectOnchainQuote
	return readClient
}

/** Activates a simulation backend serving `readClient`; `onCreateReadClient` observes each price load. */
function installSimulationBackend(readClient: ReadClient, controller: SimulationController = createSimulationController(), onCreateReadClient?: () => void) {
	const backend: ChainBackend = {
		...createFakeBackend({ profile: createFakeSimulationProfile() }),
		createReadClient: () => {
			onCreateReadClient?.()
			return readClient
		},
	}
	return installActiveEnvironmentForTesting(backend, controller)
}

function expectDisplayedPrices(repPerEth: bigint, repPerUsdc: bigint) {
	const probe = readRepPriceProbe()
	expect(probe.repPerEth).toBe(repPerEth.toString())
	expect(probe.repPerUsdc).toBe(repPerUsdc.toString())
}

function expectIdleState(refreshing: 'idle' | 'refreshing' = 'idle') {
	const probe = readRepPriceProbe()
	expect(probe.loading).toBe('ready')
	expect(probe.refreshing).toBe(refreshing)
}

function delay(milliseconds: number, schedule: typeof setTimeout = setTimeout) {
	return new Promise(resolve => schedule(resolve, milliseconds))
}

describe('useRepPrices', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			resetRepPriceCacheForTesting()
			resetActiveEnvironmentForTesting()
		},
	})

	async function renderProbe(props: Parameters<typeof PriceProbe>[0] = {}) {
		await cleanupRenderedComponent?.()
		const rendered = await renderIntoDocument(<PriceProbe {...props} />)
		cleanupRenderedComponent = rendered.cleanup
		return rendered
	}

	test('loads simulation mock REP prices using the active profile REP token', async () => {
		const resetEnvironment = installSimulationBackend(createReadClient())

		await renderProbe()

		await waitFor(() => {
			expectDisplayedPrices(REP_PER_ETH, REP_PER_USDC)
			expectIdleState()
		})
		resetEnvironment()
	})

	test.each([
		{ error: () => new Error('No Uniswap pool is available'), expectedFailure: 'no-liquidity', name: 'missing Sepolia liquidity after the automatic quote attempt' },
		{ error: createRpcError, expectedFailure: 'rpc-error', name: 'Sepolia RPC failures separately from missing liquidity' },
	])('reports $name', async ({ error, expectedFailure }) => {
		const reject = async (): Promise<never> => {
			throw error()
		}
		const backend: ChainBackend = {
			...createFakeBackend({ profile: SEPOLIA_NETWORK_PROFILE }),
			createReadClient: () => createReadClient({ profile: SEPOLIA_NETWORK_PROFILE, readContract: reject, simulateContract: reject }),
		}
		const resetEnvironment = installActiveEnvironmentForTesting(backend)

		await renderProbe()

		await waitFor(() => {
			const probe = readRepPriceProbe()
			expect(probe.ethFailure).toBe(expectedFailure)
			expect(probe.usdcFailure).toBe(expectedFailure)
			expect(probe.loading).toBe('ready')
		})
		resetEnvironment()
	})

	test('reuses cached prices for 30 seconds without refetching', async () => {
		let readContractCount = 0
		const resetEnvironment = installSimulationBackend(
			createReadClient({
				readContract: async () => {
					readContractCount += 1
					return 'REP'
				},
			}),
		)

		await renderProbe()
		await waitFor(() => {
			expectDisplayedPrices(REP_PER_ETH, REP_PER_USDC)
		})
		expect(readContractCount).toBe(2)

		await renderProbe()

		expectDisplayedPrices(REP_PER_ETH, REP_PER_USDC)
		expectIdleState()
		expect(readContractCount).toBe(2)

		resetEnvironment()
	})

	test('retains expired cached prices while refreshing them in the background', async () => {
		const simulationController = createSimulationController()
		let readDelayMilliseconds = 0
		let readClientCount = 0
		const readClient = createReadClient({
			readContract: async () => {
				if (readDelayMilliseconds > 0) await delay(readDelayMilliseconds)
				return 'REP'
			},
		})
		const resetEnvironment = installSimulationBackend(readClient, simulationController, () => {
			readClientCount += 1
		})

		await renderProbe()
		await waitFor(() => {
			expectDisplayedPrices(REP_PER_ETH, REP_PER_USDC)
		})

		const originalDateNow = Date.now
		const cachedAtMs = originalDateNow()

		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		simulationController.repPerEthPrice = 2n * REP_PER_ETH
		simulationController.repPerUsdcPrice = 2n * REP_PER_USDC
		readDelayMilliseconds = 50
		Reflect.set(Date, 'now', () => cachedAtMs + 31_000)

		try {
			await renderProbe()

			expectDisplayedPrices(REP_PER_ETH, REP_PER_USDC)
			expectIdleState('refreshing')

			await waitFor(() => {
				expectDisplayedPrices(2n * REP_PER_ETH, 2n * REP_PER_USDC)
				expect(readRepPriceProbe().refreshing).toBe('idle')
			})
			// The expired cache triggers exactly one background load, not a mount load plus an expiry-timer load.
			expect(readClientCount).toBe(2)
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
			const simulationController = createSimulationController()
			let readDelayMilliseconds = 0
			installSimulationBackend(
				createReadClient({
					readContract: async () => {
						if (readDelayMilliseconds > 0) await delay(readDelayMilliseconds, originalSetTimeout)
						return 'REP'
					},
				}),
				simulationController,
			)

			await renderProbe()
			await waitFor(() => {
				expect(readRepPriceProbe().repPerEth).toBe(REP_PER_ETH.toString())
				expect(expiryCallback).toBeDefined()
			})

			simulationController.repPerEthPrice = 2n * REP_PER_ETH
			simulationController.repPerUsdcPrice = 2n * REP_PER_USDC
			readDelayMilliseconds = 50
			const runExpiry = expiryCallback
			if (runExpiry === undefined) throw new Error('Expected REP price expiry callback')
			await act(() => {
				runExpiry()
			})
			expectDisplayedPrices(REP_PER_ETH, REP_PER_USDC)

			await waitFor(() => {
				expectDisplayedPrices(2n * REP_PER_ETH, 2n * REP_PER_USDC)
			})
		} finally {
			window.setTimeout = originalSetTimeout
		}
	})

	test('does not expose prices from the previous backend while a new backend loads', async () => {
		installSimulationBackend(createReadClient())

		const renderedComponent = await renderProbe()
		await waitFor(() => {
			expect(readRepPriceProbe().repPerEth).toBe(REP_PER_ETH.toString())
		})

		const secondController = createSimulationController()
		secondController.repPerEthPrice = 2n * REP_PER_ETH
		secondController.repPerUsdcPrice = 2n * REP_PER_USDC
		installSimulationBackend(
			createReadClient({
				readContract: async () => {
					await delay(50)
					return 'REP'
				},
			}),
			secondController,
		)

		await act(() => {
			render(<PriceProbe renderKey='second-backend' />, renderedComponent.container)
		})
		expect(readRepPriceProbe().repPerEth).toBe('-')
		expect(readRepPriceProbe().repPerUsdc).toBe('-')

		await waitFor(() => {
			expectDisplayedPrices(2n * REP_PER_ETH, 2n * REP_PER_USDC)
		})
	})

	test('ignores a saved refresh callback from the previous backend', async () => {
		installSimulationBackend(createReadClient())

		let savedFirstRefresh: (() => void) | undefined
		const captureRefresh = (refresh: () => void) => {
			savedFirstRefresh ??= refresh
		}
		const renderedComponent = await renderProbe({ captureRefresh })
		await waitFor(() => {
			expect(readRepPriceProbe().repPerEth).toBe(REP_PER_ETH.toString())
		})

		const secondController = createSimulationController()
		secondController.repPerEthPrice = 2n * REP_PER_ETH
		secondController.repPerUsdcPrice = 2n * REP_PER_USDC
		let releaseSecondReads: (() => void) | undefined
		const secondReadsReleased = new Promise<void>(resolve => {
			releaseSecondReads = resolve
		})
		let secondReadCount = 0
		installSimulationBackend(
			createReadClient({
				readContract: async () => {
					secondReadCount += 1
					await secondReadsReleased
					return 'REP'
				},
			}),
			secondController,
		)

		await act(() => {
			render(<PriceProbe captureRefresh={captureRefresh} renderKey='second-backend' />, renderedComponent.container)
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
			expectDisplayedPrices(2n * REP_PER_ETH, 2n * REP_PER_USDC)
		})
	})

	test('clears cached prices and exposes failures when a refresh cannot quote', async () => {
		let failReads = false
		installSimulationBackend(
			createReadClient({
				readContract: async () => {
					if (failReads) throw createRpcError()
					return 'REP'
				},
				simulateContract: async () => {
					if (failReads) throw createRpcError()
					return await rejectOnchainQuote()
				},
			}),
		)

		await renderProbe()
		await waitFor(() => {
			expect(readRepPriceProbe().repPerEth).toBe(REP_PER_ETH.toString())
		})

		failReads = true
		fireEvent.click(within(document.body).getByRole('button', { name: 'Refresh REP prices' }))
		await waitFor(() => {
			const probe = readRepPriceProbe()
			expect(probe.repPerEth).toBe('-')
			expect(probe.repPerUsdc).toBe('-')
			expect(probe.ethFailure).not.toBe('-')
			expect(probe.usdcFailure).not.toBe('-')
		})
	})

	test('manual refresh bypasses the 30 second cache window', async () => {
		const simulationController = createSimulationController()
		let readContractCount = 0
		let readDelayMilliseconds = 0
		const resetEnvironment = installSimulationBackend(
			createReadClient({
				readContract: async () => {
					readContractCount += 1
					if (readDelayMilliseconds > 0) await delay(readDelayMilliseconds)
					return 'REP'
				},
			}),
			simulationController,
		)

		await renderProbe()
		await waitFor(() => {
			expectDisplayedPrices(REP_PER_ETH, REP_PER_USDC)
		})
		expect(readContractCount).toBe(2)

		simulationController.repPerEthPrice = 3n * REP_PER_ETH
		simulationController.repPerUsdcPrice = 3n * REP_PER_USDC
		readDelayMilliseconds = 50

		fireEvent.click(within(document.body).getByRole('button', { name: 'Refresh REP prices' }))

		expectDisplayedPrices(REP_PER_ETH, REP_PER_USDC)

		await waitFor(() => {
			expectIdleState('refreshing')
		})

		await waitFor(() => {
			expectDisplayedPrices(3n * REP_PER_ETH, 3n * REP_PER_USDC)
			expect(readRepPriceProbe().refreshing).toBe('idle')
		})
		expect(readContractCount).toBe(4)

		resetEnvironment()
	})

	test('disabled mode skips the initial fetch until the user refreshes manually', async () => {
		let readContractCount = 0
		const resetEnvironment = installSimulationBackend(
			createReadClient({
				readContract: async () => {
					readContractCount += 1
					return 'REP'
				},
			}),
		)

		await renderProbe({ enabled: false })

		expect(readRepPriceProbe().repPerEth).toBe('-')
		expect(readRepPriceProbe().repPerUsdc).toBe('-')
		expectIdleState()
		expect(readContractCount).toBe(0)

		fireEvent.click(within(document.body).getByRole('button', { name: 'Refresh REP prices' }))

		await waitFor(() => {
			expectDisplayedPrices(REP_PER_ETH, REP_PER_USDC)
		})
		expect(readContractCount).toBe(2)

		resetEnvironment()
	})

	test('disabled mode shows cached prices without starting another background refresh', async () => {
		let readContractCount = 0
		const resetEnvironment = installSimulationBackend(
			createReadClient({
				readContract: async () => {
					readContractCount += 1
					return 'REP'
				},
			}),
		)

		await renderProbe()
		await waitFor(() => {
			expectDisplayedPrices(REP_PER_ETH, REP_PER_USDC)
		})
		expect(readContractCount).toBe(2)

		await renderProbe({ enabled: false })

		expectDisplayedPrices(REP_PER_ETH, REP_PER_USDC)
		expectIdleState()
		expect(readContractCount).toBe(2)

		resetEnvironment()
	})
})
