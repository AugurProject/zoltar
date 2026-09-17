/// <reference types="bun-types" />

import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { OracleManagerDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { usePriceOracleManager, type UsePriceOracleManagerDependencies } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/usePriceOracleManager.js'
import { describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'

type TestWriteClient = { kind: 'price-oracle-write-client' }
type UsePriceOracleManagerState = ReturnType<typeof usePriceOracleManager>

const MANAGER_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const POOL_ADDRESS = getAddress('0x00000000000000000000000000000000000000a2')
const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a3')
const TRANSACTION_HASH = '0x00000000000000000000000000000000000000000000000000000000000000a4' as const

function createOracleManagerDetails(overrides: Partial<OracleManagerDetails> = {}): OracleManagerDetails {
	return {
		callbackStateHash: undefined,
		exactToken1Report: undefined,
		isPriceValid: true,
		lastPrice: 1n,
		lastSettlementTimestamp: 1n,
		managerAddress: zeroAddress,
		openOracleAddress: zeroAddress,
		pendingOperation: undefined,
		pendingOperationSlotId: 0n,
		pendingSettlementOperationIds: [],
		pendingSettlementQueueCapacity: 4n,
		pendingReportId: 0n,
		priceValidUntilTimestamp: 1000n,
		queuedOperationCostAttoEth: 1n,
		requestPriceCostAttoEth: 1n,
		token1: zeroAddress,
		token2: zeroAddress,
		...overrides,
	}
}

function requireHookState(state: UsePriceOracleManagerState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')
	return state
}

describe('usePriceOracleManager', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreActiveEnvironment: (() => void) | undefined

	installDomTestLifecycle({
		beforeTest: () => {
			restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
		},
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			restoreActiveEnvironment?.()
			restoreActiveEnvironment = undefined
			mock.restore()
		},
	})

	test.each([undefined, 1_250_000_000_000_000_000n])('re-reads manager validity and forwards the selected initial price (%s)', async proposedPrice => {
		let managerLoadCount = 0
		const loadOracleManagerDetails = mock(async () => {
			managerLoadCount += 1
			return createOracleManagerDetails({
				isPriceValid: managerLoadCount === 1,
				managerAddress: MANAGER_ADDRESS,
				pendingReportId: 0n,
			})
		})
		const requestOraclePrice = mock(async () => {
			expect(managerLoadCount).toBe(2)
			return {
				action: 'requestPrice' as const,
				hash: TRANSACTION_HASH,
			}
		})
		const dependencies: UsePriceOracleManagerDependencies<TestWriteClient> = {
			createConnectedReadClient: () => ({
				getBalance: async () => 100n,
			}),
			createWalletWriteClient: () => ({ kind: 'price-oracle-write-client' }),
			executeOracleManagerStagedOperation: async () => {
				throw new Error('executeOracleManagerStagedOperation should not be called in this test')
			},
			loadCoordinatorInitialReportFundingRequirement: async (_client, _manager, _wallet, price) => {
				expect(price).toBe(proposedPrice)
				return {
					currentRepBalanceAttoRep: 10n,
					currentWethBalanceAttoEth: 10n,
					initialReportAmount2: 1n,
					maximumInitialAttoWeth: 1n,
					minimumToken1ReportAttoEth: 1n,
					proposedRepPerEthPrice: proposedPrice ?? 1n,
					reputationTokenAddress: zeroAddress,
					requestedInitialAttoWeth: 0n,
					wethShortfallAttoEth: 0n,
				}
			},
			loadOracleManagerDetails,
			requestOraclePrice,
		}
		let hookState: UsePriceOracleManagerState | undefined
		function Harness() {
			hookState = usePriceOracleManager(
				{
					accountAddress: WALLET_ADDRESS,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadPoolOracleManager(MANAGER_ADDRESS)
		})
		expect(requireHookState(hookState).poolOracleManagerDetails?.isPriceValid).toBe(true)

		await act(async () => {
			await requireHookState(hookState).requestPoolPrice(MANAGER_ADDRESS, POOL_ADDRESS, 1n, 0n, proposedPrice)
		})

		expect(requestOraclePrice).toHaveBeenCalledTimes(1)
		expect(requestOraclePrice).toHaveBeenCalledWith(expect.anything(), MANAGER_ADDRESS, proposedPrice ?? 1n, 0n, 1n)
		expect(loadOracleManagerDetails).toHaveBeenCalledTimes(3)
		expect(requireHookState(hookState).poolPriceOracleResult?.action).toBe('requestPrice')
	})
})
