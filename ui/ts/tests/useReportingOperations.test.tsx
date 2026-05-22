/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from 'viem'
import type { ReportingDetails } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type UseReportingOperations = typeof import('../hooks/useReportingOperations.js')['useReportingOperations']
type UseReportingOperationsState = ReturnType<UseReportingOperations>

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createReportingDetails(securityPoolAddress: Address): ReportingDetails {
	return {
		bindingCapital: 10n,
		completeSetCollateralAmount: 1n,
		currentRequiredBond: 2n,
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		marketDetails: {
			answerUnit: '',
			createdAt: 1n,
			description: 'Question description',
			displayValueMax: 100n,
			displayValueMin: 0n,
			endTime: 100n,
			exists: true,
			marketType: 'binary',
			numTicks: 2n,
			outcomeLabels: ['Yes', 'No'],
			questionId: '0x01',
			startTime: 1n,
			title: 'Will this resolve?',
		},
		nonDecisionThreshold: 20n,
		questionOutcome: 'none',
		resolution: 'none',
		securityPoolAddress,
		sides: [
			{ balance: 5n, deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
			{ balance: 2n, deposits: [], key: 'no', label: 'No', userDeposits: [] },
			{ balance: 1n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
		],
		startBond: 1n,
		status: 'active',
		startingTime: 120n,
		totalCost: 0n,
		universeId: 1n,
		withdrawalEnabled: false,
		withdrawalState: 'not-finalized',
		viewerVaultAvailableEscalationRep: 8n,
		viewerVaultExists: true,
		viewerVaultLockedRepInEscalationGame: 2n,
		viewerVaultRepDepositShare: 10n,
	}
}

function createHarness(useReportingOperations: UseReportingOperations, onRender: (state: UseReportingOperationsState) => void) {
	return function ReportingOperationsHarness() {
		const state = useReportingOperations({
			accountAddress: zeroAddress,
			onTransaction: () => undefined,
			onTransactionFinished: () => undefined,
			onTransactionRequested: () => undefined,
			onTransactionSubmitted: () => undefined,
			refreshState: async () => undefined,
		})

		onRender(state)

		return <div />
	}
}

function requireHookState(state: UseReportingOperationsState | undefined) {
	if (state === undefined) {
		throw new Error('Hook state unavailable')
	}

	return state
}

describe('useReportingOperations', () => {
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
	})

	test('loadReporting ignores stale results when overlapping requests resolve out of order', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000c1')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000c2')
		const deferredLoads: { deferred: ReturnType<typeof createDeferred<ReportingDetails>>; securityPoolAddress: Address }[] = []
		const loadReportingDetails = mock(async (_client: unknown, securityPoolAddress: Address) => {
			const deferred = createDeferred<ReportingDetails>()
			deferredLoads.push({ deferred, securityPoolAddress })
			return await deferred.promise
		})

		mock.module('../contracts.js', () => ({
			loadReportingDetails,
			reportOutcomeInSecurityPool: mock(async () => {
				throw new Error('reportOutcomeInSecurityPool should not be called in this test')
			}),
			withdrawEscalationFromSecurityPool: mock(async () => {
				throw new Error('withdrawEscalationFromSecurityPool should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useReportingOperations } = await import(`../hooks/useReportingOperations.js?case=${Date.now().toString()}`)
		let hookState: UseReportingOperationsState | undefined
		const Harness = createHarness(useReportingOperations, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setReportingForm(current => ({
				...current,
				securityPoolAddress: firstPoolAddress,
			}))
		})

		let firstLoadPromise = Promise.resolve()
		await act(async () => {
			firstLoadPromise = requireHookState(hookState).loadReporting()
			await Promise.resolve()
		})

		await act(async () => {
			requireHookState(hookState).setReportingForm(current => ({
				...current,
				securityPoolAddress: secondPoolAddress,
			}))
		})

		let secondLoadPromise = Promise.resolve()
		await act(async () => {
			secondLoadPromise = requireHookState(hookState).loadReporting()
			await Promise.resolve()
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(2)
		expect(deferredLoads.map(load => load.securityPoolAddress)).toEqual([firstPoolAddress, secondPoolAddress])

		await act(async () => {
			deferredLoads[0]?.deferred.resolve(createReportingDetails(firstPoolAddress))
			await firstLoadPromise
		})

		expect(requireHookState(hookState).reportingDetails).toBeUndefined()
		expect(requireHookState(hookState).loadingReportingDetails).toBe(true)

		await act(async () => {
			deferredLoads[1]?.deferred.resolve(createReportingDetails(secondPoolAddress))
			await secondLoadPromise
		})

		expect(requireHookState(hookState).reportingError).toBeUndefined()
		expect(requireHookState(hookState).loadingReportingDetails).toBe(false)
		expect(requireHookState(hookState).reportingDetails?.securityPoolAddress).toBe(secondPoolAddress)
		expect(requireHookState(hookState).reportingDetails?.viewerVaultAvailableEscalationRep).toBe(8n)
		expect(requireHookState(hookState).reportingDetails?.viewerVaultRepDepositShare).toBe(10n)
	})
})
