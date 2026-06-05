/// <reference types="bun-types" />

import { waitFor } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from 'viem'
import type { ReportingDetails } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type UseReportingOperations = typeof import('../hooks/useReportingOperations.js')['useReportingOperations']
type UseReportingOperationsState = ReturnType<UseReportingOperations>
const REP = 10n ** 18n

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createReportingDetails(securityPoolAddress: Address, overrides: Partial<ReportingDetails> = {}): ReportingDetails {
	return {
		bindingCapital: 10n,
		completeSetCollateralAmount: 1n,
		currentRequiredBond: 2n,
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		forkThreshold: 40n,
		hasReachedNonDecision: false,
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
		activationTime: 120n,
		startBond: 1n,
		status: 'active',
		totalCost: 0n,
		universeId: 1n,
		withdrawalEnabled: false,
		withdrawalState: 'not-finalized',
		viewerVaultAvailableEscalationRep: 8n,
		viewerVaultExists: true,
		viewerVaultLockedRepInEscalationGame: 2n,
		viewerVaultRepDepositShare: 10n,
		...overrides,
	}
}

function createHarness(useReportingOperations: UseReportingOperations, onRender: (state: UseReportingOperationsState) => void) {
	return function ReportingOperationsHarness() {
		const state = useReportingOperations({
			accountAddress: zeroAddress,
			onTransactionFinished: () => undefined,
			onTransactionPresented: () => undefined,
			onTransactionRequested: () => undefined,
			onTransactionSubmitted: () => undefined,
			refreshState: async () => undefined,
		})

		onRender(state)

		return <div />
	}
}

function requireHookState(state: UseReportingOperationsState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')

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

		const { useReportingOperations } = await import(`../hooks/useReportingOperations.js?case=${crypto.randomUUID()}`)
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
		await act(() => {
			firstLoadPromise = requireHookState(hookState).loadReporting()
		})
		await waitFor(() => {
			expect(deferredLoads).toHaveLength(1)
		})

		await act(async () => {
			requireHookState(hookState).setReportingForm(current => ({
				...current,
				securityPoolAddress: secondPoolAddress,
			}))
		})

		let secondLoadPromise = Promise.resolve()
		await act(() => {
			secondLoadPromise = requireHookState(hookState).loadReporting()
		})
		await waitFor(() => {
			expect(deferredLoads).toHaveLength(2)
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

	test('reportOutcome blocks pre-start contributions that would exceed the remaining selected-side threshold capacity', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d0')
		const latestDetails: ReportingDetails = {
			completeSetCollateralAmount: 1n,
			currentTime: 150n,
			forkThreshold: 40n * REP,
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
			nonDecisionThreshold: 20n * REP,
			questionOutcome: 'none',
			resolution: 'none',
			securityPoolAddress,
			startBond: 1n * REP,
			status: 'not-started',
			universeId: 1n,
			withdrawalEnabled: false,
			withdrawalState: 'not-finalized',
			viewerVaultAvailableEscalationRep: 8n * REP,
			viewerVaultExists: true,
			viewerVaultLockedRepInEscalationGame: 0n,
			viewerVaultRepDepositShare: 8n * REP,
		}
		const loadReportingDetails = mock(async () => latestDetails)
		const reportOutcomeInSecurityPool = mock(async () => {
			throw new Error('reportOutcomeInSecurityPool should not be called when the remaining selected-side threshold capacity is exhausted')
		})

		mock.module('../contracts.js', () => ({
			loadReportingDetails,
			reportOutcomeInSecurityPool,
			withdrawEscalationFromSecurityPool: mock(async () => {
				throw new Error('withdrawEscalationFromSecurityPool should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useReportingOperations } = await import(`../hooks/useReportingOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseReportingOperationsState | undefined
		const Harness = createHarness(useReportingOperations, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setReportingForm(current => ({
				...current,
				reportAmount: '25',
				securityPoolAddress,
				selectedOutcome: 'yes',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).onReportOutcome()
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(1)
		expect(reportOutcomeInSecurityPool).toHaveBeenCalledTimes(0)
		expect(requireHookState(hookState).reportingResult).toBeUndefined()
		expect(requireHookState(hookState).reportingFeedback?.status.detail).toBe('Only 20 REP remains before the selected side reaches the threshold')
	})

	test('withdrawEscalation validates requested deposit indexes against the provided outcome', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d1')
		const loadReportingDetails = mock(async () =>
			createReportingDetails(securityPoolAddress, {
				sides: [
					{ balance: 1n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
					{ balance: 5n, deposits: [], key: 'yes', label: 'Yes', userDeposits: [{ amount: 1n, cumulativeAmount: 1n, depositIndex: 0n, depositor: zeroAddress }] },
					{ balance: 2n, deposits: [], key: 'no', label: 'No', userDeposits: [{ amount: 1n, cumulativeAmount: 1n, depositIndex: 1n, depositor: zeroAddress }] },
				],
				withdrawalEnabled: true,
				withdrawalState: 'resolved',
			}),
		)
		const withdrawEscalationFromSecurityPool = mock(async () => {
			throw new Error('withdrawEscalationFromSecurityPool should not be called when indexes mismatch the requested side')
		})

		mock.module('../contracts.js', () => ({
			loadReportingDetails,
			reportOutcomeInSecurityPool: mock(async () => {
				throw new Error('reportOutcomeInSecurityPool should not be called in this test')
			}),
			withdrawEscalationFromSecurityPool,
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useReportingOperations } = await import(`../hooks/useReportingOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseReportingOperationsState | undefined
		const Harness = createHarness(useReportingOperations, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setReportingForm(current => ({
				...current,
				securityPoolAddress,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).withdrawEscalation('no', [0n])
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(1)
		expect(withdrawEscalationFromSecurityPool).toHaveBeenCalledTimes(0)
		expect(requireHookState(hookState).reportingResult).toBeUndefined()
		expect(requireHookState(hookState).reportingFeedback?.status.detail).toBe('Selected deposit #0 is no longer available to withdraw on No')
	})

	test('withdrawEscalation prunes selections per side after a successful refresh', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d2')
		const latestDetails = createReportingDetails(securityPoolAddress, {
			sides: [
				{ balance: 1n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [{ amount: 1n, cumulativeAmount: 1n, depositIndex: 0n, depositor: zeroAddress }] },
				{
					balance: 5n,
					deposits: [],
					key: 'yes',
					label: 'Yes',
					userDeposits: [
						{ amount: 1n, cumulativeAmount: 1n, depositIndex: 0n, depositor: zeroAddress },
						{ amount: 2n, cumulativeAmount: 3n, depositIndex: 1n, depositor: zeroAddress },
					],
				},
				{ balance: 2n, deposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			withdrawalEnabled: true,
			withdrawalState: 'resolved',
		})
		const refreshedDetails = createReportingDetails(securityPoolAddress, {
			sides: [
				{ balance: 1n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [{ amount: 1n, cumulativeAmount: 1n, depositIndex: 0n, depositor: zeroAddress }] },
				{ balance: 3n, deposits: [], key: 'yes', label: 'Yes', userDeposits: [{ amount: 2n, cumulativeAmount: 3n, depositIndex: 1n, depositor: zeroAddress }] },
				{ balance: 2n, deposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			withdrawalEnabled: true,
			withdrawalState: 'resolved',
		})
		const loadResponses = [latestDetails, refreshedDetails]
		const loadReportingDetails = mock(async () => {
			const response = loadResponses.shift()
			if (response === undefined) throw new Error('Unexpected loadReportingDetails call')
			return response
		})
		const withdrawEscalationCalls: { depositIndexes: bigint[]; outcome: string; securityPoolAddress: Address }[] = []
		const withdrawEscalationFromSecurityPool = mock(async (_client: unknown, requestedSecurityPoolAddress: Address, outcome: string, depositIndexes: bigint[]) => {
			withdrawEscalationCalls.push({
				depositIndexes,
				outcome,
				securityPoolAddress: requestedSecurityPoolAddress,
			})
			return {
				action: 'withdrawEscalation' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ef',
				outcome: 'yes' as const,
				securityPoolAddress,
				universeId: 1n,
			}
		})

		mock.module('../contracts.js', () => ({
			loadReportingDetails,
			reportOutcomeInSecurityPool: mock(async () => {
				throw new Error('reportOutcomeInSecurityPool should not be called in this test')
			}),
			withdrawEscalationFromSecurityPool,
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useReportingOperations } = await import(`../hooks/useReportingOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseReportingOperationsState | undefined
		const Harness = createHarness(useReportingOperations, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setReportingForm(current => ({
				...current,
				securityPoolAddress,
				selectedWithdrawDepositIndexesByOutcome: {
					invalid: [0n],
					yes: [0n, 1n],
					no: [2n],
				},
			}))
		})

		await act(async () => {
			await requireHookState(hookState).withdrawEscalation('yes', [0n])
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(2)
		expect(withdrawEscalationFromSecurityPool).toHaveBeenCalledTimes(1)
		expect(withdrawEscalationCalls).toEqual([
			{
				depositIndexes: [0n],
				outcome: 'yes',
				securityPoolAddress,
			},
		])
		expect(requireHookState(hookState).reportingResult).toEqual({
			action: 'withdrawEscalation',
			hash: '0x00000000000000000000000000000000000000000000000000000000000000ef',
			outcome: 'yes',
			securityPoolAddress,
			universeId: 1n,
		})
		expect(requireHookState(hookState).reportingForm.selectedWithdrawDepositIndexesByOutcome).toEqual({
			invalid: [0n],
			yes: [1n],
			no: [],
		})
	})
})
