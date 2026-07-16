/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { usePriceOracleManager, type UsePriceOracleManagerDependencies } from '../../../features/open-oracle/hooks/usePriceOracleManager.js'
import type { OracleManagerDetails, OracleOperationBounty } from '../../../types/contracts.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { createOracleManagerDetails } from '../security-pools/workflow/builders.js'

type UsePriceOracleManagerState = ReturnType<typeof usePriceOracleManager>

const MANAGER_A = getAddress('0x00000000000000000000000000000000000000a1')
const MANAGER_B = getAddress('0x00000000000000000000000000000000000000b2')
const BOARD_ADDRESS = getAddress('0x00000000000000000000000000000000000000c3')

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createManagerDetails(managerAddress: typeof MANAGER_A, operationBounties: OracleOperationBounty[] = []): OracleManagerDetails {
	return createOracleManagerDetails({
		managerAddress,
		operationBounties,
		operationBountyBoardAddress: BOARD_ADDRESS,
	})
}

function createBounty(): OracleOperationBounty {
	return {
		acceptanceDeadline: 2_000n,
		amount: 0n,
		bountyId: 1n,
		creator: MANAGER_A,
		executionErrorMessage: undefined,
		executionStatus: 'none',
		maximumInitialReportAmount2: 0n,
		minimumInitialReportAmount2: 0n,
		operation: 'setSecurityBondsAllowance',
		operationId: 0n,
		operator: zeroAddress,
		refundAvailableAt: undefined,
		reportId: 0n,
		rewardAmount: 1n,
		rewardToken: BOARD_ADDRESS,
		state: 'open',
		targetVault: MANAGER_A,
		validForSeconds: 300n,
	}
}

function requireHookState(state: UsePriceOracleManagerState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')
	return state
}

function createHarness(dependencies: UsePriceOracleManagerDependencies, onRender: (state: UsePriceOracleManagerState) => void) {
	return function PriceOracleManagerHarness() {
		const state = usePriceOracleManager(
			{
				accountAddress: undefined,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
			},
			dependencies,
		)
		onRender(state)
		return <div />
	}
}

describe('usePriceOracleManager', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
		mock.restore()
	})

	test('manager reloads discard stale bounty lookup results and errors', async () => {
		const staleBountyLookup = createDeferred<OracleOperationBounty>()
		const staleLookupError = createDeferred<OracleOperationBounty>()
		const managerLoads = [createManagerDetails(MANAGER_A), createManagerDetails(MANAGER_A), createManagerDetails(MANAGER_B)]
		const bountyLookups = [staleBountyLookup.promise, staleLookupError.promise]
		const dependencies: UsePriceOracleManagerDependencies = {
			loadOracleManagerDetails: mock(async () => {
				const details = managerLoads.shift()
				if (details === undefined) throw new Error('Unexpected manager load')
				return details
			}),
			loadOracleOperationBounty: mock(async () => {
				const bounty = bountyLookups.shift()
				if (bounty === undefined) throw new Error('Unexpected bounty lookup')
				return await bounty
			}),
		}
		let hookState: UsePriceOracleManagerState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => await requireHookState(hookState).loadPoolOracleManager(MANAGER_A))
		let staleLookupPromise: Promise<void> | undefined
		await act(() => {
			staleLookupPromise = requireHookState(hookState).loadPoolOperationBounty(MANAGER_A, 1n)
		})
		await act(async () => await requireHookState(hookState).loadPoolOracleManager(MANAGER_A))
		staleBountyLookup.resolve(createBounty())
		await act(async () => await staleLookupPromise)
		expect(requireHookState(hookState).poolOracleManagerDetails?.operationBounties).toEqual([])

		let staleErrorPromise: Promise<void> | undefined
		await act(() => {
			staleErrorPromise = requireHookState(hookState).loadPoolOperationBounty(MANAGER_A, 1n)
		})
		await act(async () => await requireHookState(hookState).loadPoolOracleManager(MANAGER_B))
		staleLookupError.reject(new Error('stale lookup failure'))
		await act(async () => await staleErrorPromise)
		expect(requireHookState(hookState).poolOracleManagerDetails?.managerAddress).toBe(MANAGER_B)
		expect(requireHookState(hookState).poolOperationBountyLookupError).toBeUndefined()
	})
})
