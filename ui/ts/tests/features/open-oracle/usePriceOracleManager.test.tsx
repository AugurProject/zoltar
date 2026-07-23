/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { usePriceOracleManager, type UsePriceOracleManagerDependencies } from '../../../features/open-oracle/hooks/usePriceOracleManager.js'
import { installActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { createFakeBackend } from '../../testUtils/fakeBackend.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { createOracleManagerDetails } from '../security-pools/workflow/builders.js'

type TestWriteClient = { kind: 'price-oracle-write-client' }
type UsePriceOracleManagerState = ReturnType<typeof usePriceOracleManager>

const MANAGER_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const POOL_ADDRESS = getAddress('0x00000000000000000000000000000000000000a2')
const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a3')
const TRANSACTION_HASH = '0x00000000000000000000000000000000000000000000000000000000000000a4' as const

function requireHookState(state: UsePriceOracleManagerState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')
	return state
}

describe('usePriceOracleManager', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreActiveEnvironment: (() => void) | undefined
	let restoreDomEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	test('re-reads manager validity immediately before requesting a price', async () => {
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
			loadCoordinatorInitialReportFundingRequirement: async () => ({
				currentRepBalance: 10n,
				currentWethBalance: 10n,
				initialReportAmount2: 1n,
				maximumInitialWeth: 1n,
				minimumToken1Report: 1n,
				proposedRepPerEthPrice: 1n,
				reputationTokenAddress: zeroAddress,
				requestedInitialWeth: 0n,
				wethShortfall: 0n,
			}),
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
			await requireHookState(hookState).requestPoolPrice(MANAGER_ADDRESS, POOL_ADDRESS, 1n)
		})

		expect(requestOraclePrice).toHaveBeenCalledTimes(1)
		expect(loadOracleManagerDetails).toHaveBeenCalledTimes(3)
		expect(requireHookState(hookState).poolPriceOracleResult?.action).toBe('requestPrice')
	})
})
