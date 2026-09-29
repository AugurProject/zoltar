/// <reference types="bun-types" />

import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { usePriceOracleManager, type UsePriceOracleManagerDependencies } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/usePriceOracleManager.js'
import { describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { createOracleManagerDetails } from '../security-pools/workflow/builders.js'

type TestWriteClient = { kind: 'price-oracle-write-client' }
type UsePriceOracleManagerState = ReturnType<typeof usePriceOracleManager>

const MANAGER_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const POOL_ADDRESS = getAddress('0x00000000000000000000000000000000000000a2')
const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a3')
const TRANSACTION_HASH = '0x00000000000000000000000000000000000000000000000000000000000000a4' as const

describe('usePriceOracleManager', () => {
	const { trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: WALLET_ADDRESS })

	test.each([
		{ proposedPrice: undefined, balance: 1n, cancelDuringFunding: false },
		{ proposedPrice: 1_250_000_000_000_000_000n, balance: 1n, cancelDuringFunding: false },
		{ proposedPrice: undefined, balance: 0n, cancelDuringFunding: false },
		{ proposedPrice: undefined, balance: 1n, cancelDuringFunding: true },
	])('checks actual REP funding and forwards the selected initial price (%s)', async ({ proposedPrice, balance, cancelDuringFunding }) => {
		const cancellation = new AbortController()
		const onTransactionCanceled = mock(() => undefined)
		const onTransactionFailed = mock(() => undefined)
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
				if (cancelDuringFunding) {
					cancellation.abort()
					throw new Error('Canceled price preparation')
				}
				return {
					currentRepBalanceAttoRep: balance,
					currentWethBalanceAttoEth: 10n,
					requiredRepAttoRep: 1n,
					initialReportAmount2: 2n,
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
					onTransactionCanceled,
					onTransactionFailed,
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
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).loadPoolOracleManager(MANAGER_ADDRESS)
		})
		expect(requireHookState(hookState).poolOracleManagerDetails?.isPriceValid).toBe(true)

		await act(async () => {
			await requireHookState(hookState).requestPoolPrice(MANAGER_ADDRESS, POOL_ADDRESS, 1n, 0n, proposedPrice, cancellation.signal)
		})

		if (cancelDuringFunding) {
			expect(onTransactionCanceled).toHaveBeenCalledTimes(1)
			expect(onTransactionFailed).not.toHaveBeenCalled()
			expect(requestOraclePrice).not.toHaveBeenCalled()
			expect(requireHookState(hookState).poolOracleFeedback).toBeUndefined()
			return
		}
		if (balance === 0n) {
			expect(requestOraclePrice).not.toHaveBeenCalled()
			return
		}
		expect(onTransactionFailed.mock.calls).toEqual([])
		expect(requireHookState(hookState).poolOracleManagerError).toBeUndefined()
		expect(requestOraclePrice).toHaveBeenCalledTimes(1)
		expect(requestOraclePrice).toHaveBeenCalledWith(expect.anything(), MANAGER_ADDRESS, proposedPrice ?? 1n, 0n, 1n)
		expect(loadOracleManagerDetails).toHaveBeenCalledTimes(3)
		expect(requireHookState(hookState).poolPriceOracleResult?.action).toBe('requestPrice')
	})
})
