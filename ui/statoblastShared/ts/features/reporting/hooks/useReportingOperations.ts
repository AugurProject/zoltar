import { questionContractAddress } from '../../../copy/questionPage.js'
import { getReportingSubmissionTimingGuard } from '../../../protocol/reportingTiming.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { lostNoActionNeeded } from '../../../copy/reportingClaims.js'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useFormState } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { approveReportingRep, loadReportingDetails, reportOutcomeInQuestionLedger, withdrawEscalationFromQuestionLedger } from '../../../protocol/reporting.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { normalizeAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { formatAdditionalCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { parseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { getDefaultReportingFormState } from '../lib/reportingForm.js'
import { parseRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { getEscalationDepositClaimAmount, getRemainingSelectedOutcomeContributionCapacity, previewReportingContribution, reportingContributionTriggersFork } from '../lib/reportingDomain.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import { createReportingSuccessPresentation, createReportingTransactionIntent, createReportingWarningPresentation } from '../../reportingTransactionPresentations.js'
import { buildWriteActionConfig, runWriteAction, type WriteActionContext } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import type { WriteOperationsParameters } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { ReportingFormState } from '../../../types/app.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ReportingActionResult, ReportingDetails } from '../../../types/contracts.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

type UseReportingOperationsParameters = WriteOperationsParameters
type ResolvedReportingOperationsParameters = UseReportingOperationsParameters & {
	selectedQuestionLedgerAddress?: string
	includeSchedule?: boolean
}

export type UseReportingOperationsDependencies = {
	approveReportingRep: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], questionLedgerAddress: Address, outcome: Parameters<typeof approveReportingRep>[2], amount: bigint) => ReturnType<typeof approveReportingRep>
	loadReportingDetails: (questionLedgerAddress: Address, accountAddress: Address | undefined, includeSchedule?: boolean) => ReturnType<typeof loadReportingDetails>
	reportOutcomeInQuestionLedger: (
		accountAddress: Address,
		callbacks: Parameters<typeof createWalletWriteClient>[1],
		questionLedgerAddress: Address,
		outcome: Parameters<typeof reportOutcomeInQuestionLedger>[2],
		amount: bigint,
		reviewAmount?: bigint,
		triggersFork?: boolean,
		requireLead?: boolean,
	) => ReturnType<typeof reportOutcomeInQuestionLedger>
	withdrawEscalationFromQuestionLedger: (
		accountAddress: Address,
		callbacks: Parameters<typeof createWalletWriteClient>[1],
		questionLedgerAddress: Address,
		outcome: Parameters<typeof withdrawEscalationFromQuestionLedger>[2],
		depositIndexes: bigint[],
		claimAmount?: bigint,
	) => ReturnType<typeof withdrawEscalationFromQuestionLedger>
}

const defaultUseReportingOperationsDependencies: UseReportingOperationsDependencies = {
	approveReportingRep: async (accountAddress, callbacks, questionLedgerAddress, outcome, amount) => await approveReportingRep(createWalletWriteClient(accountAddress, callbacks), questionLedgerAddress, outcome, amount),
	loadReportingDetails: async (questionLedgerAddress, accountAddress, includeSchedule) => await loadReportingDetails(withStatoblastRequestTimeout(createConnectedReadClient(), reportingCopy.reportingRefreshTimedOut), questionLedgerAddress, accountAddress, includeSchedule),
	reportOutcomeInQuestionLedger: async (accountAddress, callbacks, questionLedgerAddress, outcome, amount, reviewAmount, triggersFork, requireLead) => await reportOutcomeInQuestionLedger(createWalletWriteClient(accountAddress, callbacks), questionLedgerAddress, outcome, amount, reviewAmount, triggersFork, requireLead),
	withdrawEscalationFromQuestionLedger: async (accountAddress, callbacks, questionLedgerAddress, outcome, depositIndexes, claimAmount) => await withdrawEscalationFromQuestionLedger(createWalletWriteClient(accountAddress, callbacks), questionLedgerAddress, outcome, depositIndexes, claimAmount),
}

export function useReportingOperations(
	{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedQuestionLedgerAddress, includeSchedule = false }: ResolvedReportingOperationsParameters,
	dependencies: UseReportingOperationsDependencies = defaultUseReportingOperationsDependencies,
) {
	const reportingLoad = useLoadController({ timeoutMilliseconds: false })
	const reportingDetails = useSignal<ReportingDetails | undefined>(undefined)
	const reportingError = useSignal<string | undefined>(undefined)
	const { state: reportingForm, setState: setReportingForm } = useFormState<ReportingFormState>(getDefaultReportingFormState())
	const reportingActiveAction = useSignal<ReportingActionResult['action'] | undefined>(undefined)
	const reportingFeedback = useSignal<ActionFeedback<ReportingActionResult['action']> | undefined>(undefined)
	const reportingResult = useSignal<ReportingActionResult | undefined>(undefined)
	const nextReportingLoad = useRequestGuard()
	const effectiveReportingPoolAddressInput = selectedQuestionLedgerAddress?.trim() === '' || selectedQuestionLedgerAddress === undefined ? reportingForm.value.questionLedgerAddress : selectedQuestionLedgerAddress
	const currentReportingSelectionKey = normalizeAddress(effectiveReportingPoolAddressInput) ?? ''
	const currentReportingSelectionKeyRef = useRef(currentReportingSelectionKey)
	currentReportingSelectionKeyRef.current = currentReportingSelectionKey
	const currentAccountRef = useRef(accountAddress)
	currentAccountRef.current = accountAddress
	const previousAccountRef = useRef(accountAddress)
	const explicitQuestion = selectedQuestionLedgerAddress ?? ''
	const previousExplicitQuestion = useRef(explicitQuestion)
	const questionChanged = previousExplicitQuestion.current !== explicitQuestion
	const questionEpoch = useRef(0)

	const getPendingTitle = (actionName: ReportingActionResult['action']) => {
		if (actionName === 'approveReportingRep') return reportingCopy.approvingRepTitle
		return actionName === 'reportOutcome' ? reportingCopy.submittingReportTitle : reportingCopy.settlingEscalationDepositsTitle
	}
	const getSuccessTitle = (actionName: ReportingActionResult['action']) => {
		if (actionName === 'approveReportingRep') return reportingCopy.repApproved
		return actionName === 'reportOutcome' ? reportingCopy.reportSubmitted : reportingCopy.claimed
	}
	const getFailureTitle = (actionName: ReportingActionResult['action']) => {
		if (actionName === 'approveReportingRep') return reportingCopy.repApprovalFailed
		return actionName === 'reportOutcome' ? reportingCopy.reportFailed : reportingCopy.claimFailed
	}

	const requireSelectedOutcome = (selectedOutcome: ReportingFormState['selectedOutcome']) => {
		if (selectedOutcome !== undefined) return selectedOutcome
		throw new Error(reportingCopy.reportOutcomeSelectionRequired)
	}
	const isReportingSelectionCurrent = (selectionKey: string) => currentReportingSelectionKeyRef.current === selectionKey && currentAccountRef.current === accountAddress

	const resolveReportingQuestionLedgerAddress = () => parseAddressInput(effectiveReportingPoolAddressInput, questionContractAddress)

	const readReporting = async (onReadError?: (error: unknown) => void) => {
		const selectionKey = currentReportingSelectionKey
		const isCurrentLoad = nextReportingLoad()
		return await reportingLoad.run({
			isCurrent: () => isCurrentLoad() && isReportingSelectionCurrent(selectionKey),
			onStart: () => {
				reportingError.value = undefined
			},
			load: async () => {
				const questionLedgerAddress = resolveReportingQuestionLedgerAddress()
				return await dependencies.loadReportingDetails(questionLedgerAddress, accountAddress, includeSchedule)
			},
			onSuccess: details => {
				reportingDetails.value = details
			},
			onError:
				onReadError ??
				(error => {
					reportingError.value = getErrorMessage(error, reportingCopy.reportingReadFailed)
				}),
		})
	}
	const loadReporting = async () => {
		await readReporting()
	}

	useEffect(() => {
		if (previousExplicitQuestion.current === explicitQuestion) return
		previousExplicitQuestion.current = explicitQuestion
		questionEpoch.current++
		reportingLoad.invalidate()
		reportingDetails.value = undefined
		reportingError.value = undefined
		reportingFeedback.value = undefined
		reportingResult.value = undefined
		reportingActiveAction.value = undefined
		setReportingForm(() => ({ ...getDefaultReportingFormState(), questionLedgerAddress: explicitQuestion }))
	}, [explicitQuestion, reportingActiveAction, reportingDetails, reportingError, reportingFeedback, reportingLoad, reportingResult, setReportingForm])

	useEffect(() => {
		if (previousAccountRef.current === accountAddress) return
		previousAccountRef.current = accountAddress
		const hadReportingContext = reportingDetails.value !== undefined || reportingLoad.isLoading.value
		reportingDetails.value = undefined
		reportingError.value = undefined
		reportingLoad.invalidate()
		if (hadReportingContext) void loadReporting()
	}, [accountAddress, loadReporting, reportingDetails, reportingError, reportingLoad])

	const runReportingAction = async (
		actionName: ReportingActionResult['action'],
		action: (walletAddress: Address, questionLedgerAddress: Address, currentForm: ReportingFormState, isCurrentSelection: () => boolean, context: WriteActionContext) => Promise<ReportingActionResult | undefined>,
		errorFallback: string,
		outcomeOverride?: ReportingOutcomeKey,
	) => {
		if (questionChanged) return
		const currentForm = reportingForm.value
		const actionSelectionKey = currentReportingSelectionKey
		const actionQuestionEpoch = questionEpoch.current
		const transactionContext = {
			outcome: outcomeOverride ?? currentForm.selectedOutcome,
			questionLedgerAddress: actionSelectionKey === '' ? undefined : actionSelectionKey,
			universeId: reportingDetails.value?.universeId,
		}
		const isCurrentSelection = () => actionQuestionEpoch === questionEpoch.current && isReportingSelectionCurrent(actionSelectionKey)
		try {
			reportingActiveAction.value = actionName
			reportingFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName))
			await runWriteAction(
				{
					...buildWriteActionConfig(
						{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState },
						reportingError,
						commonCopy.formatConnectWalletBefore('reporting on a question'),
						createReportingTransactionIntent(actionName, transactionContext),
					),
					setErrorMessage: message => {
						if (isCurrentSelection()) reportingError.value = message
					},
					onRefreshError: (message, hash) => {
						if (!isCurrentSelection()) return
						reportingFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
						const result = reportingResult.value
						if (result !== undefined) onTransactionPresented(createReportingWarningPresentation(result, message))
					},
					onWriteCanceled: () => {
						if (actionQuestionEpoch === questionEpoch.current) reportingFeedback.value = undefined
					},
					onWriteError: message => {
						if (isCurrentSelection()) reportingFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
					refreshErrorFallback: reportingCopy.postTransactionReportingRefreshFailed,
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
					},
				},
				async (walletAddress, context) => {
					reportingResult.value = undefined
					const questionLedgerAddress = resolveReportingQuestionLedgerAddress()
					return await action(walletAddress, questionLedgerAddress, currentForm, isCurrentSelection, context)
				},
				errorFallback,
				async result => {
					onTransactionPresented(createReportingSuccessPresentation(result))
					if (!isCurrentSelection()) return
					reportingResult.value = result
					reportingFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash)
					// A submitted report must not leave its amount behind for an accidental second report.
					if (actionName === 'reportOutcome') setReportingForm(current => (current.reportAmount === '' ? current : { ...current, reportAmount: '' }))
					const details = await dependencies.loadReportingDetails(result.questionLedgerAddress, accountAddress, includeSchedule)
					if (!isCurrentSelection()) return
					reportingDetails.value = details
				},
			)
		} finally {
			if (actionQuestionEpoch === questionEpoch.current) reportingActiveAction.value = undefined
		}
	}

	const loadReportingContributionPreflight = async (walletAddress: Address, questionLedgerAddress: Address, currentForm: ReportingFormState, isCurrentSelection: () => boolean) => {
		const selectedOutcome = requireSelectedOutcome(currentForm.selectedOutcome)
		const reportAmount = parseRepAmountInput(currentForm.reportAmount, 'Report amount')
		if (reportAmount <= 0n) throw new Error(reportingCopy.invalidReportingAmount)
		const latestDetails = await dependencies.loadReportingDetails(questionLedgerAddress, walletAddress)
		if (!isCurrentSelection()) return undefined
		if (latestDetails.reportingBlockedReason !== undefined) throw new Error(latestDetails.reportingBlockedReason)
		if (latestDetails.systemState !== 'operational') throw new Error(reportingCopy.reportingUnavailable)
		const timingGuard = getReportingSubmissionTimingGuard(latestDetails.status === 'active' ? latestDetails : undefined)
		if (timingGuard !== undefined) throw new Error(timingGuard)
		const contributionPreview = previewReportingContribution(latestDetails, selectedOutcome, reportAmount)
		if (contributionPreview.actualDepositAmount === undefined) throw new Error(contributionPreview.reason ?? reportingCopy.reportPreviewUnavailable)
		const remainingSelectedOutcomeCapacity = getRemainingSelectedOutcomeContributionCapacity(latestDetails, selectedOutcome)
		if (contributionPreview.actualDepositAmount > remainingSelectedOutcomeCapacity) {
			if (remainingSelectedOutcomeCapacity === 0n) throw new Error(reportingCopy.selectedSideCapacityEmpty)
			throw new Error(reportingCopy.reportingCapacityRemaining(formatCurrencyBalanceWithUnit(remainingSelectedOutcomeCapacity, 'REP')))
		}
		const walletRepBalanceAttoRep = latestDetails.viewerWalletRepBalanceAttoRep ?? 0n
		if (contributionPreview.actualDepositAmount > walletRepBalanceAttoRep) throw new Error(reportingCopy.reportingBalanceShortfall(formatAdditionalCurrencyBalance(contributionPreview.actualDepositAmount - walletRepBalanceAttoRep, 'REP')))
		if (!isCurrentSelection()) return undefined
		return { actualDepositAmount: contributionPreview.actualDepositAmount, latestDetails, reportAmount, selectedOutcome }
	}

	/** Approves the amount chosen in the approval control, or exactly this report's wallet deposit by default. */
	const approveRepForReporting = async (amountAttoRep?: bigint) =>
		await runReportingAction(
			'approveReportingRep',
			async (walletAddress, questionLedgerAddress, currentForm, isCurrentSelection, context) => {
				const preflight = await loadReportingContributionPreflight(walletAddress, questionLedgerAddress, currentForm, isCurrentSelection)
				if (preflight === undefined) return undefined
				const approvalAmountAttoRep = amountAttoRep ?? preflight.actualDepositAmount
				const allowanceAttoRep = preflight.latestDetails.viewerWalletRepAllowanceAttoRep ?? 0n
				if (allowanceAttoRep >= approvalAmountAttoRep) throw new Error(allowanceAttoRep >= preflight.actualDepositAmount ? reportingCopy.allowanceAlreadySufficient : commonCopy.formatApprovalNotIncreasedReason(formatCurrencyBalanceWithUnit(allowanceAttoRep, 'REP')))
				return { ...(await dependencies.approveReportingRep(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal }, questionLedgerAddress, preflight.selectedOutcome, approvalAmountAttoRep)), amountAttoRep: approvalAmountAttoRep }
			},
			reportingCopy.reportingRepApprovalFailed,
		)

	const reportOutcome = async () => {
		const displayedDetails = reportingDetails.value
		await runReportingAction(
			'reportOutcome',
			async (walletAddress, questionLedgerAddress, currentForm, isCurrentSelection, context) => {
				const preflight = await loadReportingContributionPreflight(walletAddress, questionLedgerAddress, currentForm, isCurrentSelection)
				if (preflight === undefined) return undefined
				// The user confirmed the fork warning only if the displayed report already triggered the fork.
				const triggersFork = reportingContributionTriggersFork(preflight.latestDetails, preflight.selectedOutcome, preflight.reportAmount)
				if (triggersFork && !reportingContributionTriggersFork(displayedDetails, preflight.selectedOutcome, preflight.reportAmount)) {
					reportingDetails.value = preflight.latestDetails
					throw new Error(reportingCopy.forkTriggerChangedSinceReview)
				}
				if ((preflight.latestDetails.viewerWalletRepAllowanceAttoRep ?? 0n) < preflight.actualDepositAmount) {
					throw new Error(reportingCopy.reportingRepApprovalRequired)
				}
				// Wallet deposits transferFrom the accepted amount against an approval sized to the preview, so cap the maximum at that previewed amount.
				// The game only previews offers of at least the start bond, so an accepted amount trimmed below it (a tie, or a fill to the threshold)
				// is submitted as the start bond the user offered; the pool still transfers only the previewed accepted amount.
				const minimumOfferAttoRep = preflight.reportAmount < preflight.latestDetails.startBondAttoRep ? preflight.reportAmount : preflight.latestDetails.startBondAttoRep
				const walletMaximumAttoRep = preflight.actualDepositAmount > minimumOfferAttoRep ? preflight.actualDepositAmount : minimumOfferAttoRep
				const latestDetails = preflight.latestDetails
				let requireLead = true
				if (latestDetails.status === 'active') {
					const selectedSide = latestDetails.sides.find(side => side.key === preflight.selectedOutcome)
					if (selectedSide === undefined) throw new Error(reportingCopy.reportingOutcomeUnavailable)
					const resultingBalance = selectedSide.balance + preflight.actualDepositAmount
					requireLead = triggersFork || latestDetails.sides.every(side => side.key === preflight.selectedOutcome || resultingBalance > side.balance)
				}
				return {
					...(await dependencies.reportOutcomeInQuestionLedger(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal }, questionLedgerAddress, preflight.selectedOutcome, walletMaximumAttoRep, preflight.actualDepositAmount, triggersFork, requireLead)),
					amountAttoRep: preflight.actualDepositAmount,
				}
			},
			reportingCopy.reportOutcomeFailed,
		)
	}

	const withdrawEscalation = async (outcome: ReportingOutcomeKey, depositIndexes: bigint[]) =>
		await runReportingAction(
			'withdrawEscalation',
			async (walletAddress, questionLedgerAddress, _currentForm, isCurrentSelection, context) => {
				const latestDetails = await dependencies.loadReportingDetails(questionLedgerAddress, walletAddress)
				if (!isCurrentSelection()) return undefined
				if (latestDetails.status !== 'active') {
					throw new Error(reportingCopy.claimUnavailableBeforeReporting)
				}
				if (latestDetails.systemState === 'poolForked') throw new Error(reportingCopy.claimParentAfterResolution)
				if (latestDetails.systemState === 'forkMigration') throw new Error(reportingCopy.forkMigrationRequiredDetail)
				const selectedSide = latestDetails.sides.find(side => side.key === outcome)
				if (selectedSide === undefined) {
					throw new Error(reportingCopy.claimOutcomeUnavailable)
				}
				const availableDepositIndexes = selectedSide.userDeposits.map(deposit => deposit.depositIndex)

				if (latestDetails.settlementState === 'migration-required') throw new Error(reportingCopy.claimParentAfterResolution)
				if (!latestDetails.parentWithdrawalEnabled) throw new Error(reportingCopy.questionFinalizationRequired)
				if (latestDetails.questionOutcome !== outcome) throw new Error(lostNoActionNeeded)

				const missingSelectedDepositIndex = depositIndexes.find(index => !availableDepositIndexes.includes(index))
				if (missingSelectedDepositIndex !== undefined) {
					throw new Error(reportingCopy.claimDepositUnavailable(missingSelectedDepositIndex, selectedSide.label))
				}

				if (depositIndexes.length === 0) {
					throw new Error(reportingCopy.settlementSelectionRequired)
				}
				if (!isCurrentSelection()) return undefined

				const claimAmount = selectedSide.userDeposits.filter(deposit => depositIndexes.includes(deposit.depositIndex)).reduce((sum, deposit) => sum + (getEscalationDepositClaimAmount(latestDetails, outcome, deposit) ?? 0n), 0n)
				return { ...(await dependencies.withdrawEscalationFromQuestionLedger(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal }, questionLedgerAddress, outcome, depositIndexes, claimAmount)), amountAttoRep: claimAmount }
			},
			reportingCopy.claimFailed,
			outcome,
		)

	return {
		onApproveReportingRep: approveRepForReporting,
		loadingReportingDetails: reportingLoad.isLoading.value,
		loadReporting,
		readReporting,
		onReportOutcome: reportOutcome,
		reportingActiveAction: questionChanged ? undefined : reportingActiveAction.value,
		reportingDetails: questionChanged ? undefined : reportingDetails.value,
		reportingError: questionChanged ? undefined : reportingError.value,
		reportingFeedback: questionChanged ? undefined : reportingFeedback.value,
		reportingForm: questionChanged ? { ...getDefaultReportingFormState(), questionLedgerAddress: explicitQuestion } : reportingForm.value,
		reportingResult: questionChanged ? undefined : reportingResult.value,
		setReportingForm,
		withdrawEscalation,
	}
}
