/// <reference types="bun-types" />

import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createInitialTransactionTrayState, markTransactionCanceled, markTransactionFinished, markTransactionRequested } from '@zoltar/ui-core-shared/transactions/transactionTray.js'
import type { ActiveReportingDetails, EscalationSide, ReportingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { useReportingOperations, type UseReportingOperationsDependencies } from '@zoltar/ui-statoblast-shared/features/reporting/hooks/useReportingOperations.js'
import type { TransactionIntent } from '@zoltar/ui-zoltar-shared/features/types.js'
import { describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

type UseReportingOperations = typeof useReportingOperations
type UseReportingOperationsState = ReturnType<UseReportingOperations>
const ATTO_REP = 10n ** 18n
const SIDE_LABELS: Record<EscalationSide['key'], string> = { invalid: 'Invalid', yes: 'Yes', no: 'No' }
const MARKET_DETAILS: ReportingDetails['marketDetails'] = {
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
}

function side(key: EscalationSide['key'], balance: bigint, userDeposits: EscalationSide['userDeposits'] = []): EscalationSide {
	return { balance, deposits: [], importedUserDeposits: [], key, label: SIDE_LABELS[key], userDeposits }
}

function userDeposit(depositIndex: bigint, amountAttoRep: bigint, cumulativeAmountAttoRep = amountAttoRep): EscalationSide['userDeposits'][number] {
	return { amountAttoRep, cumulativeAmountAttoRep, depositIndex, depositor: zeroAddress }
}

function createReportingDetails(questionLedgerAddress: Address, overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
		bindingCapital: 10n,
		settlementCollateralAttoEth: 1n,
		currentRequiredBond: 2n,
		currentTime: 150n,
		earliestForkTime: 0n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		forkThresholdAttoRep: 40n,
		hasReachedNonDecision: false,
		marketDetails: MARKET_DETAILS,
		nonDecisionThresholdAttoRep: 20n,
		questionOutcome: 'none',
		questionLedgerAddress,
		sides: [side('invalid', 5n), side('yes', 2n), side('no', 1n)],
		activationTime: 120n,
		startBondAttoRep: 1n,
		status: 'active',
		totalCostAttoRep: 0n,
		systemState: 'operational',
		universeId: 1n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		viewerWalletRepAllowanceAttoRep: 100n * ATTO_REP,
		viewerWalletRepBalanceAttoRep: 100n * ATTO_REP,
		...overrides,
	}
}

type HarnessCallbacks = {
	includeSchedule?: boolean
	onTransactionCanceled?: () => void
	onTransactionFinished?: () => void
	onTransactionRequested?: Parameters<UseReportingOperations>[0]['onTransactionRequested']
}

function createHarness(onRender: (state: UseReportingOperationsState) => void, dependencies: UseReportingOperationsDependencies, { includeSchedule = false, onTransactionCanceled = () => undefined, onTransactionFinished = () => undefined, onTransactionRequested = () => undefined }: HarnessCallbacks = {}) {
	return function ReportingOperationsHarness({ accountAddress = zeroAddress, selectedQuestionLedgerAddress }: { accountAddress?: Address; selectedQuestionLedgerAddress?: string }) {
		const state = useReportingOperations(
			{
				accountAddress,
				includeSchedule,
				onTransactionCanceled,
				onTransactionFinished,
				onTransactionPresented: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				...(selectedQuestionLedgerAddress === undefined ? {} : { selectedQuestionLedgerAddress }),
			},
			dependencies,
		)

		onRender(state)

		return <div />
	}
}

function createReportingOperationsDependencies(overrides: Partial<UseReportingOperationsDependencies>): UseReportingOperationsDependencies {
	return {
		approveReportingRep: async () => {
			throw new Error('approveReportingRep should not be called in this test')
		},
		loadReportingDetails: async () => {
			throw new Error('loadReportingDetails should not be called in this test')
		},
		reportOutcomeInQuestionLedger: async () => {
			throw new Error('reportOutcomeInQuestionLedger should not be called in this test')
		},
		withdrawEscalationFromQuestionLedger: async () => {
			throw new Error('withdrawEscalationFromQuestionLedger should not be called in this test')
		},
		...overrides,
	}
}

describe('useReportingOperations', () => {
	const { trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: zeroAddress, installActiveEnvironment: installActiveEnvironmentForTesting })

	async function renderOperations(dependencies: UseReportingOperationsDependencies, callbacks?: HarnessCallbacks) {
		let hookState: UseReportingOperationsState | undefined
		const Harness = createHarness(
			next => {
				hookState = next
			},
			dependencies,
			callbacks,
		)
		const rendered = await renderIntoDocument(<Harness />)
		trackCleanup(rendered.cleanup)
		const state = () => requireHookState(hookState)
		const setForm = async (fields: Partial<UseReportingOperationsState['reportingForm']>) => {
			await act(async () => {
				state().setReportingForm(current => ({ ...current, ...fields }))
			})
		}
		return { Harness, container: rendered.container, state, setForm }
	}

	test('clears the draft and details when selecting another question and ignores the previous refresh', async () => {
		const first = getAddress('0x00000000000000000000000000000000000000c1')
		const second = getAddress('0x00000000000000000000000000000000000000c2')
		const firstRefresh = createDeferred<ReportingDetails>()
		let loads = 0
		const loadReportingDetails = mock(async (address: Address) => {
			loads++
			if (loads === 2) return await firstRefresh.promise
			return createReportingDetails(address)
		})
		const { Harness, container, state, setForm } = await renderOperations(createReportingOperationsDependencies({ loadReportingDetails }))
		await act(() => render(<Harness selectedQuestionLedgerAddress={first} />, container))
		await act(() => state().loadReporting())
		await setForm({ reportAmount: '12', selectedOutcome: 'yes' })
		const pending = state().loadReporting()
		await act(() => render(<Harness selectedQuestionLedgerAddress={second} />, container))
		expect(state().reportingForm.reportAmount).toBe('')
		expect(state().reportingForm.selectedOutcome).toBeUndefined()
		expect(state().reportingDetails).toBeUndefined()
		await act(() => state().loadReporting())
		firstRefresh.resolve(createReportingDetails(first))
		await pending
		expect(state().reportingDetails?.questionLedgerAddress).toBe(second)
	})

	test.each([false, true])('refreshes balances after an account change and ignores old-account loads (pending: %s)', async pending => {
		const pool = getAddress('0x00000000000000000000000000000000000000c1')
		const nextAccount = getAddress('0x00000000000000000000000000000000000000b2')
		const oldDetails = createReportingDetails(pool, { viewerWalletRepBalanceAttoRep: 8n })
		const nextDetails = createReportingDetails(pool, { viewerWalletRepBalanceAttoRep: 0n })
		const oldLoad = createDeferred<ReportingDetails>()
		const nextLoad = createDeferred<ReportingDetails>()
		const loadReportingDetails = mock(async (_pool: Address, account: Address | undefined) => {
			if (account === nextAccount) return await nextLoad.promise
			return pending ? await oldLoad.promise : oldDetails
		})
		const { Harness, container, state, setForm } = await renderOperations(createReportingOperationsDependencies({ loadReportingDetails }))
		await setForm({ questionLedgerAddress: pool })
		let firstLoad: Promise<void> | undefined
		await act(async () => {
			firstLoad = state().loadReporting()
			if (!pending) await firstLoad
		})
		await act(async () => {
			render(<Harness accountAddress={nextAccount} />, container)
		})
		expect(loadReportingDetails).toHaveBeenCalledTimes(2)
		expect(state().reportingDetails).toBeUndefined()
		await act(async () => {
			nextLoad.resolve(nextDetails)
		})
		await act(async () => {
			oldLoad.resolve(oldDetails)
			await firstLoad
		})
		await waitFor(() => {
			expect(state().reportingDetails?.viewerWalletRepBalanceAttoRep).toBe(0n)
		})
	})

	test('loadReporting ignores stale results when overlapping requests resolve out of order', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000c1')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000c2')
		const deferredLoads: { deferred: ReturnType<typeof createDeferred<ReportingDetails>>; questionLedgerAddress: Address }[] = []
		const loadReportingDetails = mock(async (questionLedgerAddress: Address) => {
			const deferred = createDeferred<ReportingDetails>()
			deferredLoads.push({ deferred, questionLedgerAddress })
			return await deferred.promise
		})

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			questionLedgerAddress: firstPoolAddress,
		})

		let firstLoadPromise = Promise.resolve()
		await act(() => {
			firstLoadPromise = state().loadReporting()
		})
		await waitFor(() => {
			expect(deferredLoads).toHaveLength(1)
		})

		await setForm({
			questionLedgerAddress: secondPoolAddress,
		})

		let secondLoadPromise = Promise.resolve()
		await act(() => {
			secondLoadPromise = state().loadReporting()
		})
		await waitFor(() => {
			expect(deferredLoads).toHaveLength(2)
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(2)
		expect(deferredLoads.map(load => load.questionLedgerAddress)).toEqual([firstPoolAddress, secondPoolAddress])

		await act(async () => {
			deferredLoads[0]?.deferred.resolve(createReportingDetails(firstPoolAddress))
			await firstLoadPromise
		})

		expect(state().reportingDetails).toBeUndefined()
		expect(state().loadingReportingDetails).toBe(true)

		await act(async () => {
			deferredLoads[1]?.deferred.resolve(createReportingDetails(secondPoolAddress))
			await secondLoadPromise
		})

		expect(state().reportingError).toBeUndefined()
		expect(state().loadingReportingDetails).toBe(false)
		expect(state().reportingDetails?.questionLedgerAddress).toBe(secondPoolAddress)
		expect(state().reportingDetails?.viewerWalletRepBalanceAttoRep).toBe(100n * ATTO_REP)
		expect(state().reportingDetails?.viewerWalletRepAllowanceAttoRep).toBe(100n * ATTO_REP)
	})

	test('reportOutcome blocks pre-start contributions that would exceed the remaining selected-side threshold capacity', async () => {
		const questionLedgerAddress = getAddress('0x00000000000000000000000000000000000000d0')
		const latestDetails: ReportingDetails = {
			settlementCollateralAttoEth: 1n,
			currentTime: 150n,
			forkThresholdAttoRep: 40n * ATTO_REP,
			marketDetails: MARKET_DETAILS,
			nonDecisionThresholdAttoRep: 20n * ATTO_REP,
			questionOutcome: 'none',
			questionLedgerAddress,
			startBondAttoRep: 1n * ATTO_REP,
			status: 'not-started',
			systemState: 'operational',
			universeId: 1n,
			settlementState: 'locked',
			parentWithdrawalEnabled: false,
		}
		const loadReportingDetails = mock(async () => latestDetails)
		const reportOutcomeInQuestionLedger = mock(async () => {
			throw new Error('reportOutcomeInQuestionLedger should not be called when the remaining selected-side threshold capacity is exhausted')
		})

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			reportOutcomeInQuestionLedger,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			reportAmount: '25',
			questionLedgerAddress,
			selectedOutcome: 'yes',
		})

		await act(async () => {
			await state().onReportOutcome()
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(1)
		expect(reportOutcomeInQuestionLedger).toHaveBeenCalledTimes(0)
		expect(state().reportingResult).toBeUndefined()
		expect(state().reportingFeedback?.status.detail).toBe('Only 20 REP remains before the selected side reaches the non-decision threshold.')
	})

	test('reportOutcome refresh blocks a newly closing response window before writing', async () => {
		const pool = getAddress('0x00000000000000000000000000000000000000d0')
		const reportOutcomeInQuestionLedger = mock(async () => {
			throw new Error('Must not write')
		})
		const { state, setForm } = await renderOperations(
			createReportingOperationsDependencies({
				loadReportingDetails: mock(async () => createReportingDetails(pool, { currentTime: 299n, escalationEndTime: 300n })),
				reportOutcomeInQuestionLedger,
			}),
		)
		await setForm({ questionLedgerAddress: pool, selectedOutcome: 'yes', reportAmount: '5' })
		await act(async () => await state().onReportOutcome())
		expect(reportOutcomeInQuestionLedger).not.toHaveBeenCalled()
		expect(state().reportingFeedback?.status.detail).toContain('response window ends too soon')
	})

	test('reportOutcome blocks writes while the pool is not operational', async () => {
		const questionLedgerAddress = getAddress('0x00000000000000000000000000000000000000d0')
		const loadReportingDetails = mock(async () =>
			createReportingDetails(questionLedgerAddress, {
				systemState: 'forkMigration',
			}),
		)
		const reportOutcomeInQuestionLedger = mock(async () => {
			throw new Error('reportOutcomeInQuestionLedger should not be called while the pool is not operational')
		})

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			reportOutcomeInQuestionLedger,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			reportAmount: '5',
			questionLedgerAddress,
			selectedOutcome: 'yes',
		})

		await act(async () => {
			await state().onReportOutcome()
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(1)
		expect(reportOutcomeInQuestionLedger).toHaveBeenCalledTimes(0)
		expect(state().reportingResult).toBeUndefined()
		expect(state().reportingFeedback?.status.detail).toBe('Reporting actions are unavailable until this question is operational.')
	})

	test.each([false, true])('reportOutcome uses wallet REP in ordinary and continuation games (continuation: %s)', async forkContinuation => {
		const questionLedgerAddress = getAddress('0x00000000000000000000000000000000000000d2')
		const walletFundingDetails = createReportingDetails(questionLedgerAddress, {
			forkContinuation,
			viewerWalletRepAllowanceAttoRep: 10n * ATTO_REP,
			viewerWalletRepBalanceAttoRep: 10n * ATTO_REP,
		})
		let submittedRequireLead: boolean | undefined
		let submittedMaximumAttoRep: bigint | undefined
		let submittedReviewAttoRep: bigint | undefined
		const loadReportingDetails = mock(async () => walletFundingDetails)
		const reportOutcomeInQuestionLedger = mock(async (...args: Parameters<UseReportingOperationsDependencies['reportOutcomeInQuestionLedger']>) => {
			submittedMaximumAttoRep = args[4]
			submittedReviewAttoRep = args[5]
			submittedRequireLead = args[7]
			return {
				action: 'reportOutcome' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000a1' as const,
				outcome: 'yes' as const,
				questionLedgerAddress,
				universeId: 1n,
			}
		})

		const { state, setForm } = await renderOperations(createReportingOperationsDependencies({ loadReportingDetails, reportOutcomeInQuestionLedger }), { includeSchedule: true })

		await setForm({
			reportAmount: '5',
			questionLedgerAddress,
			selectedOutcome: 'yes',
		})
		await act(async () => {
			await state().onReportOutcome()
		})

		expect(reportOutcomeInQuestionLedger).toHaveBeenCalledTimes(1)
		expect(submittedRequireLead).toBe(true)
		// The typed 5 REP exceeds the remaining threshold room, so the previewed accepted amount is smaller.
		expect(submittedReviewAttoRep ?? 0n).toBeLessThan(5n * ATTO_REP)
		// Wallet deposits pull the accepted amount with transferFrom, so the maximum must not exceed the reviewed and approved amount.
		expect(submittedMaximumAttoRep).toBe(submittedReviewAttoRep)
		expect(state().reportingResult?.action).toBe('reportOutcome')
		expect(loadReportingDetails).toHaveBeenLastCalledWith(questionLedgerAddress, zeroAddress, true)
		// A submitted report clears its amount so a second click cannot repeat it.
		expect(state().reportingForm.reportAmount).toBe('')
		expect(state().reportingForm.selectedOutcome).toBe('yes')
	})

	test('reportOutcome submits the offered start bond when a tie trims the accepted wallet amount below it', async () => {
		const questionLedgerAddress = getAddress('0x00000000000000000000000000000000000000d4')
		const bond = 1n * ATTO_REP
		const tiedDetails = createReportingDetails(questionLedgerAddress, {
			nonDecisionThresholdAttoRep: 275_000n * ATTO_REP,
			sides: [side('invalid', 0n), side('yes', bond), side('no', 0n)],
			activationTime: 10_000n,
			startBondAttoRep: bond,
		})
		let submittedRequireLead: boolean | undefined
		let submittedMaximumAttoRep: bigint | undefined
		let submittedReviewAttoRep: bigint | undefined
		const loadReportingDetails = mock(async () => tiedDetails)
		const reportOutcomeInQuestionLedger = mock(async (...args: Parameters<UseReportingOperationsDependencies['reportOutcomeInQuestionLedger']>) => {
			submittedMaximumAttoRep = args[4]
			submittedReviewAttoRep = args[5]
			submittedRequireLead = args[7]
			return { action: 'reportOutcome' as const, hash: '0x00000000000000000000000000000000000000000000000000000000000000a4' as const, outcome: 'no' as const, questionLedgerAddress, universeId: 1n }
		})
		const { state, setForm } = await renderOperations(createReportingOperationsDependencies({ loadReportingDetails, reportOutcomeInQuestionLedger }))
		await setForm({ reportAmount: '1', questionLedgerAddress, selectedOutcome: 'no' })
		await act(async () => {
			await state().onReportOutcome()
		})
		expect(reportOutcomeInQuestionLedger).toHaveBeenCalledTimes(1)
		// The tie leaves the report one attoREP behind the leader, but the game's preview only accepts offers of at least the start bond.
		expect(submittedReviewAttoRep).toBe(bond - 1n)
		expect(submittedMaximumAttoRep).toBe(bond)
		expect(submittedRequireLead).toBe(false)
	})

	test.each([true, false])('reportOutcome marks fork-triggering reports for review only when the displayed report already triggered the fork (displayed: %s)', async displayedTriggersFork => {
		const questionLedgerAddress = getAddress('0x00000000000000000000000000000000000000d3')
		// Invalid already sits at the 20 attoREP threshold, so filling Yes with 18 attoREP ends escalation and triggers the fork.
		const forkReadySides: ActiveReportingDetails['sides'] = [side('invalid', 20n), side('yes', 2n), side('no', 1n)]
		const latestDetails = createReportingDetails(questionLedgerAddress, { sides: forkReadySides })
		const displayedDetails = displayedTriggersFork ? latestDetails : createReportingDetails(questionLedgerAddress, {})
		const loadReportingDetails = mock(async () => (loadReportingDetails.mock.calls.length === 1 ? displayedDetails : latestDetails))
		let submittedTriggersFork: boolean | undefined
		const reportOutcomeInQuestionLedger = mock(async (...args: Parameters<UseReportingOperationsDependencies['reportOutcomeInQuestionLedger']>) => {
			submittedTriggersFork = args[6]
			return { action: 'reportOutcome' as const, hash: '0x00000000000000000000000000000000000000000000000000000000000000a2' as const, outcome: 'yes' as const, questionLedgerAddress, universeId: 1n }
		})
		const { state, setForm } = await renderOperations(createReportingOperationsDependencies({ loadReportingDetails, reportOutcomeInQuestionLedger }))
		await setForm({ reportAmount: '0.000000000000000018', questionLedgerAddress, selectedOutcome: 'yes' })
		await act(async () => {
			await state().loadReporting()
		})
		await act(async () => {
			await state().onReportOutcome()
		})
		if (displayedTriggersFork) {
			expect(reportOutcomeInQuestionLedger).toHaveBeenCalledTimes(1)
			expect(submittedTriggersFork).toBe(true)
		} else {
			// The user never saw or confirmed the fork warning, so the report stops and shows the updated state.
			expect(reportOutcomeInQuestionLedger).not.toHaveBeenCalled()
			expect(state().reportingFeedback?.status.detail).toBe('This report would now trigger the universe fork. Review the fork warning and confirm before reporting.')
			expect(state().reportingDetails).toBe(latestDetails)
			expect(state().reportingForm.reportAmount).toBe('0.000000000000000018')
		}
	})

	test.each([undefined, 8n * ATTO_REP])('onApproveReportingRep approves the chosen amount, or the accepted contribution by default, for an active ordinary game (%s)', async chosenAmount => {
		const questionLedgerAddress = getAddress('0x00000000000000000000000000000000000000d3')
		const walletFundingDetails = createReportingDetails(questionLedgerAddress, {
			nonDecisionThresholdAttoRep: 20n * ATTO_REP,
			sides: [side('invalid', 1n * ATTO_REP), side('yes', 5n * ATTO_REP), side('no', 8n * ATTO_REP)],
			viewerWalletRepAllowanceAttoRep: 0n,
			viewerWalletRepBalanceAttoRep: 10n * ATTO_REP,
		})
		const loadReportingDetails = mock(async () => walletFundingDetails)
		const approveReportingRep = mock(async (_accountAddress: Address, _callbacks: unknown, _pool: Address, outcome: 'invalid' | 'yes' | 'no', _amount: bigint) => ({
			action: 'approveReportingRep' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000a2' as const,
			outcome,
			questionLedgerAddress,
			universeId: 1n,
		}))

		const { state, setForm } = await renderOperations(createReportingOperationsDependencies({ approveReportingRep, loadReportingDetails }))

		await setForm({ reportAmount: '5', questionLedgerAddress, selectedOutcome: 'yes' })
		await act(async () => {
			await state().onApproveReportingRep(chosenAmount)
		})

		expect(approveReportingRep).toHaveBeenCalledTimes(1)
		expect(approveReportingRep.mock.calls[0]?.[4]).toBe(chosenAmount ?? 5n * ATTO_REP)
		expect(state().reportingResult?.action).toBe('approveReportingRep')
	})

	test('onApproveReportingRep rejects an amount that does not raise the allowance', async () => {
		const questionLedgerAddress = getAddress('0x00000000000000000000000000000000000000d4')
		const details = createReportingDetails(questionLedgerAddress, { nonDecisionThresholdAttoRep: 20n * ATTO_REP, viewerWalletRepAllowanceAttoRep: 3n * ATTO_REP, viewerWalletRepBalanceAttoRep: 10n * ATTO_REP })
		const approveReportingRep = mock(async () => {
			throw new Error('Must not approve')
		})
		const { state, setForm } = await renderOperations(createReportingOperationsDependencies({ approveReportingRep, loadReportingDetails: mock(async () => details) }))
		await setForm({ reportAmount: '5', questionLedgerAddress, selectedOutcome: 'yes' })
		await act(async () => await state().onApproveReportingRep(2n * ATTO_REP))
		expect(approveReportingRep).not.toHaveBeenCalled()
		const detail = state().reportingFeedback?.status.detail
		expect(typeof detail === 'string' ? detail.replaceAll('\u00a0', ' ') : detail).toContain('Already approved 3')
	})

	test('withdrawEscalation validates requested deposit indexes against the provided outcome', async () => {
		const questionLedgerAddress = getAddress('0x00000000000000000000000000000000000000d1')
		const loadReportingDetails = mock(async () =>
			createReportingDetails(questionLedgerAddress, {
				sides: [side('invalid', 1n), side('yes', 5n, [userDeposit(0n, 1n)]), side('no', 2n, [userDeposit(1n, 1n)])],
				settlementState: 'resolved',
				parentWithdrawalEnabled: true,
			}),
		)
		const withdrawEscalationFromQuestionLedger = mock(async () => {
			throw new Error('withdrawEscalationFromQuestionLedger should not be called when indexes mismatch the requested side')
		})

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			withdrawEscalationFromQuestionLedger,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			questionLedgerAddress,
		})

		await act(async () => {
			await state().withdrawEscalation('no', [0n])
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(1)
		expect(withdrawEscalationFromQuestionLedger).toHaveBeenCalledTimes(0)
		expect(state().reportingResult).toBeUndefined()
		expect(state().reportingFeedback?.status.detail).toBe('Deposit #0 is no longer available to claim on No.')
	})

	test.each([
		['poolForked', 'Claim winning deposits in the child question after it resolves.'],
		['forkMigration', 'Set up the child questions in Fork & recovery. Your deposits carry over. Claim winning deposits after the child question resolves.'],
	] as const)('withdrawEscalation explains what to do after a fork (%s)', async (systemState, reason) => {
		const questionLedgerAddress = getAddress('0x00000000000000000000000000000000000000d1')
		const loadReportingDetails = mock(async () => createReportingDetails(questionLedgerAddress, { systemState }))
		const withdrawEscalationFromQuestionLedger = mock(async () => {
			throw new Error('Must not send while the question is moving to a child universe')
		})
		const { state, setForm } = await renderOperations(createReportingOperationsDependencies({ loadReportingDetails, withdrawEscalationFromQuestionLedger }))
		await setForm({ questionLedgerAddress })
		await act(async () => await state().withdrawEscalation('yes', [0n]))
		expect(state().reportingFeedback?.status.detail).toBe(reason)
		expect(withdrawEscalationFromQuestionLedger).not.toHaveBeenCalled()
	})

	test('withdrawEscalation prunes selections per side after a successful refresh', async () => {
		const questionLedgerAddress = getAddress('0x00000000000000000000000000000000000000d2')
		const latestDetails = createReportingDetails(questionLedgerAddress, {
			sides: [side('invalid', 1n, [userDeposit(0n, 1n)]), side('yes', 5n, [userDeposit(0n, 1n), userDeposit(1n, 2n, 3n)]), side('no', 2n)],
			currentTime: 301n,
			escalationEndTime: 300n,
			settlementState: 'resolved',
			parentWithdrawalEnabled: true,
		})
		const refreshedDetails = createReportingDetails(questionLedgerAddress, {
			sides: [side('invalid', 1n, [userDeposit(0n, 1n)]), side('yes', 3n, [userDeposit(1n, 2n, 3n)]), side('no', 2n)],
			currentTime: 301n,
			escalationEndTime: 300n,
			settlementState: 'resolved',
			parentWithdrawalEnabled: true,
		})
		const loadResponses = [latestDetails, refreshedDetails]
		const loadReportingDetails = mock(async () => {
			const response = loadResponses.shift()
			if (response === undefined) throw new Error('Unexpected loadReportingDetails call')
			return response
		})
		const withdrawEscalationCalls: { depositIndexes: bigint[]; outcome: string; questionLedgerAddress: Address }[] = []
		const withdrawEscalationFromQuestionLedger = mock(async (_accountAddress: Address, _callbacks: unknown, requestedQuestionLedgerAddress: Address, outcome: string, depositIndexes: bigint[]) => {
			withdrawEscalationCalls.push({
				depositIndexes,
				outcome,
				questionLedgerAddress: requestedQuestionLedgerAddress,
			})
			return {
				action: 'withdrawEscalation' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ef' as const,
				outcome: 'yes' as const,
				questionLedgerAddress,
				universeId: 1n,
			}
		})

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			withdrawEscalationFromQuestionLedger,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			questionLedgerAddress,
			selectedWithdrawDepositIndexesByOutcome: {
				invalid: [0n],
				yes: [0n, 1n],
				no: [2n],
			},
		})

		await act(async () => {
			await state().withdrawEscalation('yes', [0n])
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(2)
		expect(withdrawEscalationFromQuestionLedger).toHaveBeenCalledTimes(1)
		expect(withdrawEscalationCalls).toEqual([
			{
				depositIndexes: [0n],
				outcome: 'yes',
				questionLedgerAddress,
			},
		])
		expect(state().reportingResult).toEqual({
			amountAttoRep: 0n,
			action: 'withdrawEscalation',
			hash: '0x00000000000000000000000000000000000000000000000000000000000000ef',
			outcome: 'yes',
			questionLedgerAddress,
			universeId: 1n,
		})
		expect(state().reportingForm.selectedWithdrawDepositIndexesByOutcome).toEqual({
			invalid: [0n],
			yes: [1n],
			no: [],
		})
	})

	test('withdrawEscalation ignores a stale post-success refresh after the selected pool changes', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000e1')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000e2')
		const staleRefresh = createDeferred<ReportingDetails>()
		let firstPoolLoadCount = 0
		const firstPoolDetails = createReportingDetails(firstPoolAddress, {
			sides: [side('invalid', 0n), side('yes', 2n, [userDeposit(0n, 1n)]), side('no', 0n)],
			settlementState: 'resolved',
			parentWithdrawalEnabled: true,
		})
		const secondPoolDetails = createReportingDetails(secondPoolAddress, {
			sides: [side('invalid', 0n), side('yes', 4n, [userDeposit(2n, 2n)]), side('no', 3n, [userDeposit(3n, 3n)])],
			settlementState: 'resolved',
			parentWithdrawalEnabled: true,
		})
		const loadReportingDetails = mock(async (questionLedgerAddress: Address) => {
			if (questionLedgerAddress === firstPoolAddress) {
				firstPoolLoadCount += 1
				if (firstPoolLoadCount === 1) return firstPoolDetails
				return await staleRefresh.promise
			}
			if (questionLedgerAddress === secondPoolAddress) return secondPoolDetails
			throw new Error(`Unexpected question ledger ${questionLedgerAddress}`)
		})
		const withdrawEscalationFromQuestionLedger = mock(async () => ({
			action: 'withdrawEscalation' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000aa' as const,
			outcome: 'yes' as const,
			questionLedgerAddress: firstPoolAddress,
			universeId: 1n,
		}))

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			withdrawEscalationFromQuestionLedger,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			questionLedgerAddress: firstPoolAddress,
			selectedWithdrawDepositIndexesByOutcome: {
				invalid: [],
				yes: [0n],
				no: [],
			},
		})

		let withdrawPromise = Promise.resolve()
		await act(() => {
			withdrawPromise = state().withdrawEscalation('yes', [0n])
		})

		await waitFor(() => expect(loadReportingDetails).toHaveBeenCalledTimes(2))

		await setForm({
			questionLedgerAddress: secondPoolAddress,
			selectedWithdrawDepositIndexesByOutcome: {
				invalid: [],
				yes: [2n],
				no: [3n],
			},
		})

		await act(async () => {
			await state().loadReporting()
		})

		await waitFor(() => expect(state().reportingDetails?.questionLedgerAddress).toBe(secondPoolAddress))
		expect(state().reportingForm.selectedWithdrawDepositIndexesByOutcome).toEqual({
			invalid: [],
			yes: [2n],
			no: [3n],
		})

		await act(async () => {
			staleRefresh.resolve(firstPoolDetails)
			await withdrawPromise
		})

		expect(state().reportingDetails?.questionLedgerAddress).toBe(secondPoolAddress)
		expect(state().reportingForm.selectedWithdrawDepositIndexesByOutcome).toEqual({
			invalid: [],
			yes: [2n],
			no: [3n],
		})
		expect(withdrawEscalationFromQuestionLedger).toHaveBeenCalledTimes(1)
	})

	test('reportOutcome ignores a stale preflight reload after the selected pool changes', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000f2')
		const stalePreflight = createDeferred<ReportingDetails>()
		const loadReportingDetails = mock(async (questionLedgerAddress: Address) => {
			if (questionLedgerAddress === firstPoolAddress) return await stalePreflight.promise
			if (questionLedgerAddress === secondPoolAddress) return createReportingDetails(secondPoolAddress)
			throw new Error(`Unexpected question ledger ${questionLedgerAddress}`)
		})
		const reportOutcomeInQuestionLedger = mock(async () => ({
			action: 'reportOutcome' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000ab' as const,
			outcome: 'yes' as const,
			questionLedgerAddress: firstPoolAddress,
			universeId: 1n,
		}))
		let transactionState = createInitialTransactionTrayState()

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			reportOutcomeInQuestionLedger,
		})

		const { state, setForm } = await renderOperations(dependencies, {
			onTransactionCanceled: () => {
				transactionState = markTransactionCanceled(transactionState)
			},
			onTransactionFinished: () => {
				transactionState = markTransactionFinished(transactionState)
			},
			onTransactionRequested: (intent: TransactionIntent) => {
				transactionState = markTransactionRequested(transactionState, intent)
			},
		})

		await setForm({
			reportAmount: '1',
			questionLedgerAddress: firstPoolAddress,
			selectedOutcome: 'yes',
		})

		let reportPromise = Promise.resolve()
		await act(() => {
			reportPromise = state().onReportOutcome()
		})

		await waitFor(() => expect(loadReportingDetails).toHaveBeenCalledTimes(1))
		expect(state().reportingFeedback?.status.tone).toBe('pending')
		expect(transactionState.entries[0]?.intent.action).toBe('reportOutcome')

		await setForm({
			questionLedgerAddress: secondPoolAddress,
		})

		await act(async () => {
			await state().loadReporting()
		})

		await waitFor(() => expect(state().reportingDetails?.questionLedgerAddress).toBe(secondPoolAddress))

		await act(async () => {
			stalePreflight.resolve(createReportingDetails(firstPoolAddress))
			await reportPromise
		})

		expect(state().reportingDetails?.questionLedgerAddress).toBe(secondPoolAddress)
		expect(state().reportingFeedback).toBeUndefined()
		expect(reportOutcomeInQuestionLedger).not.toHaveBeenCalled()
		expect(transactionState.active).toBeUndefined()
		expect(transactionState.entries).toEqual([])
		expect(transactionState.entries.length).toBe(0)
	})
})
