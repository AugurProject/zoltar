/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, zeroHash } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import type { DeploymentStatus, TradingDetails, ZoltarUniverseSummary } from '../types/contracts.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type UseTradingOperations = typeof import('../hooks/useTradingOperations.js')['useTradingOperations']
type UseTradingOperationsState = ReturnType<UseTradingOperations>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a2')
const SECURITY_POOL_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')

function createDeploymentStep(id: DeploymentStatus['id']): DeploymentStatus {
	return {
		address: zeroAddress,
		dependencies: [],
		deploy: async () => zeroAddress,
		deployed: true,
		id,
		label: id,
	}
}

function createTradingDetails(overrides: Partial<TradingDetails> = {}): TradingDetails {
	return {
		maxRedeemableCompleteSets: 0n,
		shareBalances: {
			invalid: 0n,
			no: 0n,
			yes: 0n,
		},
		universeId: 1n,
		...overrides,
	}
}

function createUniverseSummary(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [],
		forkThreshold: 1n,
		forkQuestionDetails: undefined,
		forkTime: 0n,
		forkingOutcomeIndex: 0n,
		hasForked: false,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupply: 1n,
		universeId: 1n,
		...overrides,
	}
}

function requireHookState(state: UseTradingOperationsState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')

	return state
}

function createHarness(useTradingOperations: UseTradingOperations, onRender: (state: UseTradingOperationsState) => void, onTransactionFailed: (message: string) => void, { onTransactionRequested = () => undefined }: { onTransactionRequested?: () => void } = {}) {
	return function TradingOperationsHarness() {
		const state = useTradingOperations({
			accountAddress: WALLET_ADDRESS,
			deploymentStatuses: [createDeploymentStep('proxyDeployer')],
			enabled: true,
			onTransactionFailed,
			onTransactionFinished: () => undefined,
			onTransactionPresented: () => undefined,
			onTransactionRequested,
			onTransactionSubmitted: () => undefined,
			refreshState: async () => undefined,
			selectedSecurityPoolAddress: SECURITY_POOL_ADDRESS,
		})
		onRender(state)
		return <div />
	}
}

describe('useTradingOperations', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let resetEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		resetEnvironment?.()
		resetEnvironment = undefined
		resetActiveEnvironmentForTesting()
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	test('blocks complete-set mint writes when latest pool capacity has no collateral exchange rate', async () => {
		const createCompleteSetInSecurityPool = mock(async () => {
			throw new Error('createCompleteSetInSecurityPool should not be called when the latest mint capacity has no exchange rate')
		})
		const createWalletWriteClient = mock(() => {
			throw new Error('createWalletWriteClient should not be called before mint guard validation passes')
		})
		const onTransactionFailed = mock(() => undefined)
		const readClient = {
			getBalance: mock(async () => 2n * 10n ** 18n),
		}

		mock.module('../contracts.js', () => ({
			createCompleteSetInSecurityPool,
			loadSecurityPoolMintCapacity: mock(async () => ({
				completeSetCollateralAmount: 0n,
				shareTokenSupply: 10n * 10n ** 18n,
				totalRepDeposit: 20n * 10n ** 18n,
				totalSecurityBondAllowance: 2n * 10n ** 18n,
			})),
			loadTradingDetails: mock(async () => createTradingDetails()),
			loadZoltarUniverseSummary: mock(async () => createUniverseSummary()),
			migrateSharesFromUniverse: mock(async () => {
				throw new Error('migrateSharesFromUniverse should not be called in this test')
			}),
			redeemCompleteSetInSecurityPool: mock(async () => {
				throw new Error('redeemCompleteSetInSecurityPool should not be called in this test')
			}),
			redeemSharesInSecurityPool: mock(async () => {
				throw new Error('redeemSharesInSecurityPool should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => readClient),
			createWalletWriteClient,
		}))

		const { useTradingOperations } = await import(`../hooks/useTradingOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseTradingOperationsState | undefined
		const Harness = createHarness(
			useTradingOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({
				...current,
				completeSetAmount: '1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).createCompleteSet()
		})

		expect(onTransactionFailed).toHaveBeenCalledWith('Minting is unavailable because this pool has complete-set shares but no collateral')
		expect(createCompleteSetInSecurityPool).not.toHaveBeenCalled()
		expect(createWalletWriteClient).not.toHaveBeenCalled()
	})

	test('converts redeem complete-set input to share units before submitting', async () => {
		const firstMintShareAmount = 10n ** 36n
		let submittedRedeemAmount: bigint | undefined
		const redeemCompleteSetInSecurityPool = mock(async (_client: unknown, securityPoolAddress: typeof SECURITY_POOL_ADDRESS, amount: bigint) => {
			submittedRedeemAmount = amount
			return {
				action: 'redeemCompleteSet',
				hash: zeroHash,
				securityPoolAddress,
				universeId: 1n,
			}
		})
		const createWalletWriteClient = mock(() => ({}))
		const onTransactionFailed = mock(() => undefined)
		const readClient = {
			getBalance: mock(async () => 2n * 10n ** 18n),
		}

		mock.module('../contracts.js', () => ({
			createCompleteSetInSecurityPool: mock(async () => {
				throw new Error('createCompleteSetInSecurityPool should not be called in this test')
			}),
			loadSecurityPoolMintCapacity: mock(async () => ({
				completeSetCollateralAmount: 1n * 10n ** 18n,
				shareTokenSupply: firstMintShareAmount,
				totalRepDeposit: 20n * 10n ** 18n,
				totalSecurityBondAllowance: 2n * 10n ** 18n,
			})),
			loadTradingDetails: mock(async () =>
				createTradingDetails({
					maxRedeemableCompleteSets: firstMintShareAmount,
					shareBalances: {
						invalid: firstMintShareAmount,
						no: firstMintShareAmount,
						yes: firstMintShareAmount,
					},
				}),
			),
			loadZoltarUniverseSummary: mock(async () => createUniverseSummary()),
			migrateSharesFromUniverse: mock(async () => {
				throw new Error('migrateSharesFromUniverse should not be called in this test')
			}),
			redeemCompleteSetInSecurityPool,
			redeemSharesInSecurityPool: mock(async () => {
				throw new Error('redeemSharesInSecurityPool should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => readClient),
			createWalletWriteClient,
		}))

		const { useTradingOperations } = await import(`../hooks/useTradingOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseTradingOperationsState | undefined
		const Harness = createHarness(
			useTradingOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({
				...current,
				redeemAmount: '1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).redeemCompleteSet()
		})

		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(redeemCompleteSetInSecurityPool).toHaveBeenCalled()
		expect(submittedRedeemAmount).toBe(firstMintShareAmount)
	})

	test('does not request a mint transaction when the active wallet account changed', async () => {
		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))

		const createCompleteSetInSecurityPool = mock(async () => {
			throw new Error('createCompleteSetInSecurityPool should not be called when the active wallet account changed')
		})
		const readClient = {
			getBalance: mock(async () => 2n * 10n ** 18n),
		}
		const createConnectedReadClient = mock(() => readClient)
		const createWalletWriteClient = mock(() => {
			throw new Error('createWalletWriteClient should not be called before the active wallet guard passes')
		})
		const onTransactionFailed = mock(() => undefined)
		const onTransactionRequested = mock(() => undefined)
		const loadSecurityPoolMintCapacity = mock(async () => ({
			completeSetCollateralAmount: 1n * 10n ** 18n,
			shareTokenSupply: 1n * 10n ** 18n,
			totalRepDeposit: 20n * 10n ** 18n,
			totalSecurityBondAllowance: 2n * 10n ** 18n,
		}))
		const loadTradingDetails = mock(async () => createTradingDetails())
		const loadZoltarUniverseSummary = mock(async () => createUniverseSummary())

		mock.module('../contracts.js', () => ({
			createCompleteSetInSecurityPool,
			loadSecurityPoolMintCapacity,
			loadTradingDetails,
			loadZoltarUniverseSummary,
			migrateSharesFromUniverse: mock(async () => {
				throw new Error('migrateSharesFromUniverse should not be called in this test')
			}),
			redeemCompleteSetInSecurityPool: mock(async () => {
				throw new Error('redeemCompleteSetInSecurityPool should not be called in this test')
			}),
			redeemSharesInSecurityPool: mock(async () => {
				throw new Error('redeemSharesInSecurityPool should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient,
			createWalletWriteClient,
		}))

		const { useTradingOperations } = await import(`../hooks/useTradingOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseTradingOperationsState | undefined
		const Harness = createHarness(
			useTradingOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
			{ onTransactionRequested },
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup
		createConnectedReadClient.mockClear()
		loadTradingDetails.mockClear()
		loadZoltarUniverseSummary.mockClear()
		loadSecurityPoolMintCapacity.mockClear()

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({
				...current,
				completeSetAmount: '1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).createCompleteSet()
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Wallet account changed. Review the action with the connected account and try again')
		expect(createConnectedReadClient).not.toHaveBeenCalled()
		expect(loadTradingDetails).not.toHaveBeenCalled()
		expect(loadZoltarUniverseSummary).not.toHaveBeenCalled()
		expect(loadSecurityPoolMintCapacity).not.toHaveBeenCalled()
		expect(createWalletWriteClient).not.toHaveBeenCalled()
		expect(createCompleteSetInSecurityPool).not.toHaveBeenCalled()
	})

	test('does not request a share-migration transaction when the active wallet account changed', async () => {
		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))

		const migrateSharesFromUniverse = mock(async () => {
			throw new Error('migrateSharesFromUniverse should not be called when the active wallet account changed')
		})
		const readClient = {
			getBalance: mock(async () => 2n * 10n ** 18n),
		}
		const createConnectedReadClient = mock(() => readClient)
		const createWalletWriteClient = mock(() => {
			throw new Error('createWalletWriteClient should not be called before the active wallet guard passes')
		})
		const onTransactionFailed = mock(() => undefined)
		const onTransactionRequested = mock(() => undefined)
		const loadTradingDetails = mock(async () =>
			createTradingDetails({
				shareBalances: {
					invalid: 0n,
					no: 1n * 10n ** 18n,
					yes: 1n * 10n ** 18n,
				},
			}),
		)
		const loadZoltarUniverseSummary = mock(async () =>
			createUniverseSummary({
				childUniverses: [
					{
						exists: true,
						forkTime: 0n,
						outcomeIndex: 0n,
						outcomeLabel: 'Invalid',
						parentUniverseId: 1n,
						reputationToken: zeroAddress,
						universeId: 2n,
					},
				],
				hasForked: true,
			}),
		)

		mock.module('../contracts.js', () => ({
			createCompleteSetInSecurityPool: mock(async () => {
				throw new Error('createCompleteSetInSecurityPool should not be called in this test')
			}),
			loadSecurityPoolMintCapacity: mock(async () => {
				throw new Error('loadSecurityPoolMintCapacity should not be called when the active wallet account changed')
			}),
			loadTradingDetails,
			loadZoltarUniverseSummary,
			migrateSharesFromUniverse,
			redeemCompleteSetInSecurityPool: mock(async () => {
				throw new Error('redeemCompleteSetInSecurityPool should not be called in this test')
			}),
			redeemSharesInSecurityPool: mock(async () => {
				throw new Error('redeemSharesInSecurityPool should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient,
			createWalletWriteClient,
		}))

		const { useTradingOperations } = await import(`../hooks/useTradingOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseTradingOperationsState | undefined
		const Harness = createHarness(
			useTradingOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
			{ onTransactionRequested },
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup
		createConnectedReadClient.mockClear()
		loadTradingDetails.mockClear()
		loadZoltarUniverseSummary.mockClear()

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({
				...current,
				selectedShareOutcome: 'yes',
				targetOutcomeIndexes: '0,1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).migrateShares()
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Wallet account changed. Review the action with the connected account and try again')
		expect(createConnectedReadClient).not.toHaveBeenCalled()
		expect(loadTradingDetails).not.toHaveBeenCalled()
		expect(loadZoltarUniverseSummary).not.toHaveBeenCalled()
		expect(createWalletWriteClient).not.toHaveBeenCalled()
		expect(migrateSharesFromUniverse).not.toHaveBeenCalled()
	})
})
