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

function createReportingDetails(securityPoolAddress: Address, overrides: Partial<ReportingDetails> = {}): ReportingDetails {
	return {
		bindingCapital: 10n,
		settlementCollateralAttoEth: 1n,
		currentRequiredBond: 2n,
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		forkThresholdAttoRep: 40n,
		hasReachedNonDecision: false,
		marketDetails: MARKET_DETAILS,
		nonDecisionThresholdAttoRep: 20n,
		questionOutcome: 'none',
		securityPoolAddress,
		sides: [side('invalid', 5n), side('yes', 2n), side('no', 1n)],
		activationTime: 120n,
		startBondAttoRep: 1n,
		status: 'active',
		totalCostAttoRep: 0n,
		systemState: 'operational',
		universeId: 1n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		viewerPoolHeldVaultRepBackingAttoRep: 8n,
		viewerWalletRepAllowanceAttoRep: 100n * ATTO_REP,
		viewerWalletRepBalanceAttoRep: 100n * ATTO_REP,
		viewerVaultExists: true,
		viewerVaultDisputeStakedAttoRep: 2n,
		viewerVaultRepBackingAttoRep: 10n,
		...overrides,
	}
}

type HarnessCallbacks = {
	onTransactionCanceled?: () => void
	onTransactionFinished?: () => void
	onTransactionRequested?: Parameters<UseReportingOperations>[0]['onTransactionRequested']
}

function createHarness(onRender: (state: UseReportingOperationsState) => void, dependencies: UseReportingOperationsDependencies, { onTransactionCanceled = () => undefined, onTransactionFinished = () => undefined, onTransactionRequested = () => undefined }: HarnessCallbacks = {}) {
	return function ReportingOperationsHarness({ accountAddress = zeroAddress }: { accountAddress?: Address }) {
		const state = useReportingOperations(
			{
				accountAddress,
				onTransactionCanceled,
				onTransactionFinished,
				onTransactionPresented: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
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
		reportOutcomeInSecurityPool: async () => {
			throw new Error('reportOutcomeInSecurityPool should not be called in this test')
		},
		withdrawEscalationFromSecurityPool: async () => {
			throw new Error('withdrawEscalationFromSecurityPool should not be called in this test')
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

	test.each([false, true])('refreshes balances after an account change and ignores old-account loads (pending: %s)', async pending => {
		const pool = getAddress('0x00000000000000000000000000000000000000c1')
		const nextAccount = getAddress('0x00000000000000000000000000000000000000b2')
		const oldDetails = createReportingDetails(pool, { viewerPoolHeldVaultRepBackingAttoRep: 8n })
		const nextDetails = createReportingDetails(pool, { viewerVaultExists: false, viewerPoolHeldVaultRepBackingAttoRep: 0n })
		const oldLoad = createDeferred<ReportingDetails>()
		const nextLoad = createDeferred<ReportingDetails>()
		const loadReportingDetails = mock(async (_pool: Address, account: Address | undefined) => {
			if (account === nextAccount) return await nextLoad.promise
			return pending ? await oldLoad.promise : oldDetails
		})
		const { Harness, container, state, setForm } = await renderOperations(createReportingOperationsDependencies({ loadReportingDetails }))
		await setForm({ securityPoolAddress: pool })
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
			expect(state().reportingDetails?.viewerPoolHeldVaultRepBackingAttoRep).toBe(0n)
		})
	})

	test('loadReporting ignores stale results when overlapping requests resolve out of order', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000c1')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000c2')
		const deferredLoads: { deferred: ReturnType<typeof createDeferred<ReportingDetails>>; securityPoolAddress: Address }[] = []
		const loadReportingDetails = mock(async (securityPoolAddress: Address) => {
			const deferred = createDeferred<ReportingDetails>()
			deferredLoads.push({ deferred, securityPoolAddress })
			return await deferred.promise
		})

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			securityPoolAddress: firstPoolAddress,
		})

		let firstLoadPromise = Promise.resolve()
		await act(() => {
			firstLoadPromise = state().loadReporting()
		})
		await waitFor(() => {
			expect(deferredLoads).toHaveLength(1)
		})

		await setForm({
			securityPoolAddress: secondPoolAddress,
		})

		let secondLoadPromise = Promise.resolve()
		await act(() => {
			secondLoadPromise = state().loadReporting()
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

		expect(state().reportingDetails).toBeUndefined()
		expect(state().loadingReportingDetails).toBe(true)

		await act(async () => {
			deferredLoads[1]?.deferred.resolve(createReportingDetails(secondPoolAddress))
			await secondLoadPromise
		})

		expect(state().reportingError).toBeUndefined()
		expect(state().loadingReportingDetails).toBe(false)
		expect(state().reportingDetails?.securityPoolAddress).toBe(secondPoolAddress)
		expect(state().reportingDetails?.viewerPoolHeldVaultRepBackingAttoRep).toBe(8n)
		expect(state().reportingDetails?.viewerVaultRepBackingAttoRep).toBe(10n)
	})

	test('reportOutcome blocks pre-start contributions that would exceed the remaining selected-side threshold capacity', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d0')
		const latestDetails: ReportingDetails = {
			settlementCollateralAttoEth: 1n,
			currentTime: 150n,
			forkThresholdAttoRep: 40n * ATTO_REP,
			marketDetails: MARKET_DETAILS,
			nonDecisionThresholdAttoRep: 20n * ATTO_REP,
			questionOutcome: 'none',
			securityPoolAddress,
			startBondAttoRep: 1n * ATTO_REP,
			status: 'not-started',
			systemState: 'operational',
			universeId: 1n,
			settlementState: 'locked',
			parentWithdrawalEnabled: false,
			viewerPoolHeldVaultRepBackingAttoRep: 8n * ATTO_REP,
			viewerVaultExists: true,
			viewerVaultDisputeStakedAttoRep: 0n,
			viewerVaultRepBackingAttoRep: 8n * ATTO_REP,
		}
		const loadReportingDetails = mock(async () => latestDetails)
		const reportOutcomeInSecurityPool = mock(async () => {
			throw new Error('reportOutcomeInSecurityPool should not be called when the remaining selected-side threshold capacity is exhausted')
		})

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			reportOutcomeInSecurityPool,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			reportAmount: '25',
			securityPoolAddress,
			selectedOutcome: 'yes',
		})

		await act(async () => {
			await state().onReportOutcome()
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(1)
		expect(reportOutcomeInSecurityPool).toHaveBeenCalledTimes(0)
		expect(state().reportingResult).toBeUndefined()
		expect(state().reportingFeedback?.status.detail).toBe('Only 20 REP remains before the selected side reaches the non-decision threshold.')
	})

	test('reportOutcome refresh blocks a newly closing response window before writing', async () => {
		const pool = getAddress('0x00000000000000000000000000000000000000d0')
		const reportOutcomeInSecurityPool = mock(async () => {
			throw new Error('Must not write')
		})
		const { state, setForm } = await renderOperations(
			createReportingOperationsDependencies({
				loadReportingDetails: mock(async () => createReportingDetails(pool, { currentTime: 299n, escalationEndTime: 300n })),
				reportOutcomeInSecurityPool,
			}),
		)
		await setForm({ securityPoolAddress: pool, selectedOutcome: 'yes', reportAmount: '5' })
		await act(async () => await state().onReportOutcome())
		expect(reportOutcomeInSecurityPool).not.toHaveBeenCalled()
		expect(state().reportingFeedback?.status.detail).toContain('response window ends too soon')
	})

	test('reportOutcome blocks writes while the pool is not operational', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d0')
		const loadReportingDetails = mock(async () =>
			createReportingDetails(securityPoolAddress, {
				systemState: 'forkCollateralRepairAuction',
			}),
		)
		const reportOutcomeInSecurityPool = mock(async () => {
			throw new Error('reportOutcomeInSecurityPool should not be called while the pool is not operational')
		})

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			reportOutcomeInSecurityPool,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			reportAmount: '5',
			securityPoolAddress,
			selectedOutcome: 'yes',
		})

		await act(async () => {
			await state().onReportOutcome()
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(1)
		expect(reportOutcomeInSecurityPool).toHaveBeenCalledTimes(0)
		expect(state().reportingResult).toBeUndefined()
		expect(state().reportingFeedback?.status.detail).toBe('Reporting actions are unavailable until this pool is operational.')
	})

	test.each([false, true])('reportOutcome uses wallet REP in ordinary and continuation games (continuation: %s)', async forkContinuation => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d2')
		const walletFundingDetails = createReportingDetails(securityPoolAddress, {
			forkContinuation,
			contributionFunding: 'wallet',
			viewerPoolHeldVaultRepBackingAttoRep: 0n,
			viewerVaultExists: false,
			viewerWalletRepAllowanceAttoRep: 10n * ATTO_REP,
			viewerWalletRepBalanceAttoRep: 10n * ATTO_REP,
		})
		let submittedFunding: 'wallet' | 'vault' | undefined
		let submittedMaximumAttoRep: bigint | undefined
		let submittedReviewAttoRep: bigint | undefined
		const loadReportingDetails = mock(async () => walletFundingDetails)
		const reportOutcomeInSecurityPool = mock(async (...args: Parameters<UseReportingOperationsDependencies['reportOutcomeInSecurityPool']>) => {
			submittedMaximumAttoRep = args[4]
			submittedReviewAttoRep = args[5]
			submittedFunding = args[6]
			return {
				action: 'reportOutcome' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000a1' as const,
				outcome: 'yes' as const,
				securityPoolAddress,
				universeId: 1n,
			}
		})

		const { state, setForm } = await renderOperations(createReportingOperationsDependencies({ loadReportingDetails, reportOutcomeInSecurityPool }))

		await setForm({
			contributionFunding: 'wallet',
			reportAmount: '5',
			securityPoolAddress,
			selectedOutcome: 'yes',
		})
		await act(async () => {
			await state().onReportOutcome()
		})

		expect(reportOutcomeInSecurityPool).toHaveBeenCalledTimes(1)
		expect(submittedFunding).toBe('wallet')
		// The typed 5 REP exceeds the remaining threshold room, so the previewed accepted amount is smaller.
		expect(submittedReviewAttoRep ?? 0n).toBeLessThan(5n * ATTO_REP)
		// Wallet deposits pull the accepted amount with transferFrom, so the maximum must not exceed the reviewed and approved amount.
		expect(submittedMaximumAttoRep).toBe(submittedReviewAttoRep)
		expect(state().reportingResult?.action).toBe('reportOutcome')
		// A submitted report clears its amount so a second click cannot repeat it.
		expect(state().reportingForm.reportAmount).toBe('')
		expect(state().reportingForm.selectedOutcome).toBe('yes')
	})

	test.each([true, false])('reportOutcome marks fork-triggering reports for review only when the displayed report already triggered the fork (displayed: %s)', async displayedTriggersFork => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d3')
		// Invalid already sits at the 20 attoREP threshold, so filling Yes with 18 attoREP ends escalation and triggers the fork.
		const forkReadySides: ActiveReportingDetails['sides'] = [side('invalid', 20n), side('yes', 2n), side('no', 1n)]
		const latestDetails = createReportingDetails(securityPoolAddress, { sides: forkReadySides, viewerPoolHeldVaultRepBackingAttoRep: 100n })
		const displayedDetails = displayedTriggersFork ? latestDetails : createReportingDetails(securityPoolAddress, { viewerPoolHeldVaultRepBackingAttoRep: 100n })
		const loadReportingDetails = mock(async () => (loadReportingDetails.mock.calls.length === 1 ? displayedDetails : latestDetails))
		let submittedTriggersFork: boolean | undefined
		const reportOutcomeInSecurityPool = mock(async (...args: Parameters<UseReportingOperationsDependencies['reportOutcomeInSecurityPool']>) => {
			submittedTriggersFork = args[7]
			return { action: 'reportOutcome' as const, hash: '0x00000000000000000000000000000000000000000000000000000000000000a2' as const, outcome: 'yes' as const, securityPoolAddress, universeId: 1n }
		})
		const { state, setForm } = await renderOperations(createReportingOperationsDependencies({ loadReportingDetails, reportOutcomeInSecurityPool }))
		await setForm({ contributionFunding: 'wallet', reportAmount: '0.000000000000000018', securityPoolAddress, selectedOutcome: 'yes' })
		await act(async () => {
			await state().loadReporting()
		})
		await act(async () => {
			await state().onReportOutcome()
		})
		if (displayedTriggersFork) {
			expect(reportOutcomeInSecurityPool).toHaveBeenCalledTimes(1)
			expect(submittedTriggersFork).toBe(true)
		} else {
			// The user never saw or confirmed the fork warning, so the report stops and shows the updated state.
			expect(reportOutcomeInSecurityPool).not.toHaveBeenCalled()
			expect(state().reportingFeedback?.status.detail).toBe('This report would now trigger the universe fork. Review the fork warning and confirm before reporting.')
			expect(state().reportingDetails).toBe(latestDetails)
			expect(state().reportingForm.reportAmount).toBe('0.000000000000000018')
		}
	})

	test.each([undefined, 8n * ATTO_REP])('onApproveReportingRep approves the chosen amount, or the accepted contribution by default, for an active ordinary game (%s)', async chosenAmount => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d3')
		const walletFundingDetails = createReportingDetails(securityPoolAddress, {
			contributionFunding: 'wallet',
			nonDecisionThresholdAttoRep: 20n * ATTO_REP,
			sides: [side('invalid', 1n * ATTO_REP), side('yes', 5n * ATTO_REP), side('no', 8n * ATTO_REP)],
			viewerPoolHeldVaultRepBackingAttoRep: 0n,
			viewerVaultExists: false,
			viewerVaultRepBackingAttoRep: 0n,
			viewerWalletRepAllowanceAttoRep: 0n,
			viewerWalletRepBalanceAttoRep: 10n * ATTO_REP,
		})
		const loadReportingDetails = mock(async () => walletFundingDetails)
		const approveReportingRep = mock(async (_accountAddress: Address, _callbacks: unknown, _pool: Address, outcome: 'invalid' | 'yes' | 'no', _amount: bigint) => ({
			action: 'approveReportingRep' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000a2' as const,
			outcome,
			securityPoolAddress,
			universeId: 1n,
		}))

		const { state, setForm } = await renderOperations(createReportingOperationsDependencies({ approveReportingRep, loadReportingDetails }))

		await setForm({ reportAmount: '5', securityPoolAddress, selectedOutcome: 'yes' })
		await act(async () => {
			await state().onApproveReportingRep(chosenAmount)
		})

		expect(approveReportingRep).toHaveBeenCalledTimes(1)
		expect(approveReportingRep.mock.calls[0]?.[4]).toBe(chosenAmount ?? 5n * ATTO_REP)
		expect(state().reportingResult?.action).toBe('approveReportingRep')
	})

	test('onApproveReportingRep rejects an amount that does not raise the allowance', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d4')
		const details = createReportingDetails(securityPoolAddress, { contributionFunding: 'wallet', nonDecisionThresholdAttoRep: 20n * ATTO_REP, viewerWalletRepAllowanceAttoRep: 3n * ATTO_REP, viewerWalletRepBalanceAttoRep: 10n * ATTO_REP })
		const approveReportingRep = mock(async () => {
			throw new Error('Must not approve')
		})
		const { state, setForm } = await renderOperations(createReportingOperationsDependencies({ approveReportingRep, loadReportingDetails: mock(async () => details) }))
		await setForm({ reportAmount: '5', securityPoolAddress, selectedOutcome: 'yes' })
		await act(async () => await state().onApproveReportingRep(2n * ATTO_REP))
		expect(approveReportingRep).not.toHaveBeenCalled()
		const detail = state().reportingFeedback?.status.detail
		expect(typeof detail === 'string' ? detail.replaceAll('\u00a0', ' ') : detail).toContain('Already approved 3')
	})

	test('withdrawEscalation validates requested deposit indexes against the provided outcome', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d1')
		const loadReportingDetails = mock(async () =>
			createReportingDetails(securityPoolAddress, {
				sides: [side('invalid', 1n), side('yes', 5n, [userDeposit(0n, 1n)]), side('no', 2n, [userDeposit(1n, 1n)])],
				settlementState: 'resolved',
				parentWithdrawalEnabled: true,
			}),
		)
		const withdrawEscalationFromSecurityPool = mock(async () => {
			throw new Error('withdrawEscalationFromSecurityPool should not be called when indexes mismatch the requested side')
		})

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			withdrawEscalationFromSecurityPool,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			securityPoolAddress,
		})

		await act(async () => {
			await state().withdrawEscalation('no', [0n])
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(1)
		expect(withdrawEscalationFromSecurityPool).toHaveBeenCalledTimes(0)
		expect(state().reportingResult).toBeUndefined()
		expect(state().reportingFeedback?.status.detail).toBe('Selected deposit #0 is no longer available to settle on No.')
	})

	test('withdrawEscalation reports when the unresolved escalation migration window has closed', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d4')
		const loadReportingDetails = mock(async () =>
			createReportingDetails(securityPoolAddress, {
				settlementState: 'migration-expired',
				sides: [side('invalid', 1n, [userDeposit(0n, 1n)]), side('yes', 2n), side('no', 3n)],
			}),
		)
		const withdrawEscalationFromSecurityPool = mock(async () => {
			throw new Error('withdrawEscalationFromSecurityPool should not be called when the migration window has closed')
		})

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			withdrawEscalationFromSecurityPool,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			securityPoolAddress,
			selectedWithdrawDepositIndexesByOutcome: {
				invalid: [0n],
				yes: [],
				no: [],
			},
		})

		await act(async () => {
			await state().withdrawEscalation('invalid')
		})

		expect(loadReportingDetails).toHaveBeenCalledTimes(1)
		expect(withdrawEscalationFromSecurityPool).toHaveBeenCalledTimes(0)
		expect(state().reportingResult).toBeUndefined()
		expect(state().reportingFeedback?.status.detail).toBe('Settle winning parent deposits in the finalized child pool; the window for the optional cleanup of unresolved parent deposits has closed.')
	})

	test('withdrawEscalation prunes selections per side after a successful refresh', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000d2')
		const latestDetails = createReportingDetails(securityPoolAddress, {
			sides: [side('invalid', 1n, [userDeposit(0n, 1n)]), side('yes', 5n, [userDeposit(0n, 1n), userDeposit(1n, 2n, 3n)]), side('no', 2n)],
			currentTime: 301n,
			escalationEndTime: 300n,
			settlementState: 'resolved',
			parentWithdrawalEnabled: true,
		})
		const refreshedDetails = createReportingDetails(securityPoolAddress, {
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
		const withdrawEscalationCalls: { depositIndexes: bigint[]; outcome: string; securityPoolAddress: Address }[] = []
		const withdrawEscalationFromSecurityPool = mock(async (_accountAddress: Address, _callbacks: unknown, requestedSecurityPoolAddress: Address, outcome: string, depositIndexes: bigint[]) => {
			withdrawEscalationCalls.push({
				depositIndexes,
				outcome,
				securityPoolAddress: requestedSecurityPoolAddress,
			})
			return {
				action: 'withdrawEscalation' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ef' as const,
				outcome: 'yes' as const,
				securityPoolAddress,
				universeId: 1n,
			}
		})

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			withdrawEscalationFromSecurityPool,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			securityPoolAddress,
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
		expect(withdrawEscalationFromSecurityPool).toHaveBeenCalledTimes(1)
		expect(withdrawEscalationCalls).toEqual([
			{
				depositIndexes: [0n],
				outcome: 'yes',
				securityPoolAddress,
			},
		])
		expect(state().reportingResult).toEqual({
			amountAttoRep: 0n,
			action: 'withdrawEscalation',
			hash: '0x00000000000000000000000000000000000000000000000000000000000000ef',
			outcome: 'yes',
			securityPoolAddress,
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
		const loadReportingDetails = mock(async (securityPoolAddress: Address) => {
			if (securityPoolAddress === firstPoolAddress) {
				firstPoolLoadCount += 1
				if (firstPoolLoadCount === 1) return firstPoolDetails
				return await staleRefresh.promise
			}
			if (securityPoolAddress === secondPoolAddress) return secondPoolDetails
			throw new Error(`Unexpected security pool ${securityPoolAddress}`)
		})
		const withdrawEscalationFromSecurityPool = mock(async () => ({
			action: 'withdrawEscalation' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000aa' as const,
			outcome: 'yes' as const,
			securityPoolAddress: firstPoolAddress,
			universeId: 1n,
		}))

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			withdrawEscalationFromSecurityPool,
		})

		const { state, setForm } = await renderOperations(dependencies)

		await setForm({
			securityPoolAddress: firstPoolAddress,
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
			securityPoolAddress: secondPoolAddress,
			selectedWithdrawDepositIndexesByOutcome: {
				invalid: [],
				yes: [2n],
				no: [3n],
			},
		})

		await act(async () => {
			await state().loadReporting()
		})

		await waitFor(() => expect(state().reportingDetails?.securityPoolAddress).toBe(secondPoolAddress))
		expect(state().reportingForm.selectedWithdrawDepositIndexesByOutcome).toEqual({
			invalid: [],
			yes: [2n],
			no: [3n],
		})

		await act(async () => {
			staleRefresh.resolve(firstPoolDetails)
			await withdrawPromise
		})

		expect(state().reportingDetails?.securityPoolAddress).toBe(secondPoolAddress)
		expect(state().reportingForm.selectedWithdrawDepositIndexesByOutcome).toEqual({
			invalid: [],
			yes: [2n],
			no: [3n],
		})
		expect(withdrawEscalationFromSecurityPool).toHaveBeenCalledTimes(1)
	})

	test('reportOutcome ignores a stale preflight reload after the selected pool changes', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000f2')
		const stalePreflight = createDeferred<ReportingDetails>()
		const loadReportingDetails = mock(async (securityPoolAddress: Address) => {
			if (securityPoolAddress === firstPoolAddress) return await stalePreflight.promise
			if (securityPoolAddress === secondPoolAddress) return createReportingDetails(secondPoolAddress)
			throw new Error(`Unexpected security pool ${securityPoolAddress}`)
		})
		const reportOutcomeInSecurityPool = mock(async () => ({
			action: 'reportOutcome' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000ab' as const,
			outcome: 'yes' as const,
			securityPoolAddress: firstPoolAddress,
			universeId: 1n,
		}))
		let transactionState = createInitialTransactionTrayState()

		const dependencies = createReportingOperationsDependencies({
			loadReportingDetails,
			reportOutcomeInSecurityPool,
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
			securityPoolAddress: firstPoolAddress,
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
			securityPoolAddress: secondPoolAddress,
		})

		await act(async () => {
			await state().loadReporting()
		})

		await waitFor(() => expect(state().reportingDetails?.securityPoolAddress).toBe(secondPoolAddress))

		await act(async () => {
			stalePreflight.resolve(createReportingDetails(firstPoolAddress))
			await reportPromise
		})

		expect(state().reportingDetails?.securityPoolAddress).toBe(secondPoolAddress)
		expect(state().reportingFeedback).toBeUndefined()
		expect(reportOutcomeInSecurityPool).not.toHaveBeenCalled()
		expect(transactionState.active).toBeUndefined()
		expect(transactionState.entries).toEqual([])
		expect(transactionState.entries.length).toBe(0)
	})
})
