import { useSignal } from '@preact/signals'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import type { Address } from '@zoltar/shared/ethereum'
import { loadReportingDetails, reportOutcomeInSecurityPool, withdrawEscalationFromSecurityPool } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput } from '../lib/inputs.js'
import { getDefaultReportingFormState, getDefaultReportingWithdrawDepositIndexesByOutcome, parseRepAmountInput } from '../lib/marketForm.js'
import { getRemainingSelectedOutcomeContributionCapacity, previewReportingContribution } from '../lib/reportingDomain.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import type { ActionFeedback } from '../lib/actionFeedback.js'
import { createReportingSuccessPresentation, createReportingTransactionIntent, createReportingWarningPresentation } from '../lib/transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import type { ReportingFormState, ReportingWithdrawDepositIndexesByOutcome, WriteOperationsParameters } from '../types/app.js'
import type { ReportingActionResult, ReportingDetails, ReportingOutcomeKey } from '../types/contracts.js'

type UseReportingOperationsParameters = WriteOperationsParameters
type ResolvedReportingOperationsParameters = UseReportingOperationsParameters & {
	selectedSecurityPoolAddress?: string
}

function getAvailableWithdrawDepositIndexes(details: ReportingDetails, outcome: ReportingOutcomeKey) {
	if (details.status !== 'active') return []
	const side = details.sides.find(candidate => candidate.key === outcome)
	return side?.userDeposits.map(deposit => deposit.depositIndex) ?? []
}

function filterAvailableWithdrawDepositIndexes(selectedDepositIndexes: bigint[], availableDepositIndexes: bigint[]) {
	return selectedDepositIndexes.filter(index => availableDepositIndexes.includes(index))
}

function sameSelectedWithdrawDepositIndexes(left: bigint[], right: bigint[]) {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameSelectedWithdrawDepositIndexesByOutcome(left: ReportingWithdrawDepositIndexesByOutcome, right: ReportingWithdrawDepositIndexesByOutcome) {
	return sameSelectedWithdrawDepositIndexes(left.invalid, right.invalid) && sameSelectedWithdrawDepositIndexes(left.yes, right.yes) && sameSelectedWithdrawDepositIndexes(left.no, right.no)
}

function pruneSelectedWithdrawDepositIndexesByOutcome(currentSelections: ReportingWithdrawDepositIndexesByOutcome, details: ReportingDetails) {
	if (details.status !== 'active') return getDefaultReportingWithdrawDepositIndexesByOutcome()

	return {
		invalid: filterAvailableWithdrawDepositIndexes(currentSelections.invalid, getAvailableWithdrawDepositIndexes(details, 'invalid')),
		yes: filterAvailableWithdrawDepositIndexes(currentSelections.yes, getAvailableWithdrawDepositIndexes(details, 'yes')),
		no: filterAvailableWithdrawDepositIndexes(currentSelections.no, getAvailableWithdrawDepositIndexes(details, 'no')),
	}
}

export function useReportingOperations({ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedSecurityPoolAddress }: ResolvedReportingOperationsParameters) {
	const reportingLoad = useLoadController()
	const reportingDetails = useSignal<ReportingDetails | undefined>(undefined)
	const reportingError = useSignal<string | undefined>(undefined)
	const { state: reportingForm, setState: setReportingForm } = useFormState<ReportingFormState>(getDefaultReportingFormState())
	const reportingActiveAction = useSignal<ReportingActionResult['action'] | undefined>(undefined)
	const reportingFeedback = useSignal<ActionFeedback<ReportingActionResult['action']> | undefined>(undefined)
	const reportingResult = useSignal<ReportingActionResult | undefined>(undefined)
	const nextReportingLoad = useRequestGuard()

	const getPendingTitle = (actionName: ReportingActionResult['action']) => (actionName === 'reportOutcome' ? 'Submitting report' : 'Settling escalation deposits')
	const getSuccessTitle = (actionName: ReportingActionResult['action']) => (actionName === 'reportOutcome' ? 'Report submitted' : 'Escalation deposits settled')
	const getFailureTitle = (actionName: ReportingActionResult['action']) => (actionName === 'reportOutcome' ? 'Report failed' : 'Settlement failed')

	const requireSelectedOutcome = (selectedOutcome: ReportingFormState['selectedOutcome']) => {
		if (selectedOutcome !== undefined) return selectedOutcome
		throw new Error('Select an outcome side before reporting on a market.')
	}

	const resolveReportingSecurityPoolAddress = () => parseAddressInput(selectedSecurityPoolAddress?.trim() === '' || selectedSecurityPoolAddress === undefined ? reportingForm.value.securityPoolAddress : selectedSecurityPoolAddress, 'Security pool address')

	const loadReporting = async () => {
		const isCurrent = nextReportingLoad()
		await reportingLoad.run({
			isCurrent,
			onStart: () => {
				reportingError.value = undefined
			},
			load: async () => {
				const securityPoolAddress = resolveReportingSecurityPoolAddress()
				return await loadReportingDetails(createConnectedReadClient(), securityPoolAddress, accountAddress)
			},
			onSuccess: details => {
				reportingDetails.value = details
			},
			onError: error => {
				reportingDetails.value = undefined
				reportingError.value = getErrorMessage(error, 'Failed to load reporting details')
			},
		})
	}

	const runReportingAction = async (actionName: ReportingActionResult['action'], action: (walletAddress: Address, securityPoolAddress: Address, currentForm: ReportingFormState) => Promise<ReportingActionResult>, errorFallback: string) => {
		const currentForm = reportingForm.value
		try {
			reportingActiveAction.value = actionName
			reportingFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName))
			await runWriteAction(
				{
					...buildWriteActionConfig({ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState }, reportingError, 'Connect a wallet before reporting on a market', createReportingTransactionIntent(actionName)),
					onRefreshError: (message, hash) => {
						reportingFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
						const result = reportingResult.value
						if (result !== undefined) onTransactionPresented(createReportingWarningPresentation(result, message))
					},
					onWriteError: message => {
						reportingFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
					refreshErrorFallback: 'Reporting transaction succeeded, but refreshing reporting details failed',
				},
				async walletAddress => {
					reportingResult.value = undefined
					const securityPoolAddress = resolveReportingSecurityPoolAddress()
					return await action(walletAddress, securityPoolAddress, currentForm)
				},
				errorFallback,
				async result => {
					reportingResult.value = result
					reportingFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash)
					onTransactionPresented(createReportingSuccessPresentation(result))
					const details = await loadReportingDetails(createConnectedReadClient(), result.securityPoolAddress, accountAddress)
					reportingDetails.value = details
					setReportingForm(current => {
						const selectedWithdrawDepositIndexesByOutcome = pruneSelectedWithdrawDepositIndexesByOutcome(current.selectedWithdrawDepositIndexesByOutcome, details)
						if (sameSelectedWithdrawDepositIndexesByOutcome(current.selectedWithdrawDepositIndexesByOutcome, selectedWithdrawDepositIndexesByOutcome)) return current
						return {
							...current,
							selectedWithdrawDepositIndexesByOutcome,
						}
					})
				},
			)
		} finally {
			reportingActiveAction.value = undefined
		}
	}

	const reportOutcome = async () =>
		await runReportingAction(
			'reportOutcome',
			async (walletAddress, securityPoolAddress, currentForm) => {
				const selectedOutcome = requireSelectedOutcome(currentForm.selectedOutcome)
				const reportAmount = parseRepAmountInput(currentForm.reportAmount, 'Report amount')
				const latestDetails = await loadReportingDetails(createConnectedReadClient(), securityPoolAddress, walletAddress)
				if (latestDetails.systemState !== 'operational') throw new Error('Reporting actions are unavailable until this pool is operational.')
				const contributionPreview = previewReportingContribution(latestDetails, selectedOutcome, reportAmount)
				if (contributionPreview.actualDepositAmount === undefined) throw new Error(contributionPreview.reason ?? 'Unable to preview the REP that would be locked for this report.')
				if (!latestDetails.viewerVaultExists) throw new Error('Reporting locks REP already deposited in your security vault. Deposit REP into your vault before reporting.')
				const remainingSelectedOutcomeCapacity = getRemainingSelectedOutcomeContributionCapacity(latestDetails, selectedOutcome)
				if (contributionPreview.actualDepositAmount > remainingSelectedOutcomeCapacity) {
					if (remainingSelectedOutcomeCapacity === 0n) throw new Error('No remaining contribution capacity is available on the selected side.')
					throw new Error(`Only ${formatCurrencyBalance(remainingSelectedOutcomeCapacity)} REP remains before the selected side reaches the threshold.`)
				}
				const availableVaultRep = latestDetails.viewerVaultAvailableEscalationRep ?? 0n
				if (contributionPreview.actualDepositAmount > availableVaultRep) throw new Error(`Insufficient unlocked REP in your vault. Need ${formatCurrencyBalance(contributionPreview.actualDepositAmount - availableVaultRep)} more REP deposited and unlocked before reporting.`)

				return await reportOutcomeInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), securityPoolAddress, selectedOutcome, reportAmount)
			},
			'Failed to report on outcome',
		)

	const withdrawEscalation = async (outcome: ReportingOutcomeKey, depositIndexesOverride?: bigint[]) =>
		await runReportingAction(
			'withdrawEscalation',
			async (walletAddress, securityPoolAddress, currentForm) => {
				const latestDetails = await loadReportingDetails(createConnectedReadClient(), securityPoolAddress, walletAddress)
				if (latestDetails.status !== 'active') {
					throw new Error('Withdrawals are unavailable until the first report or contribution deploys the escalation game.')
				}
				if (latestDetails.systemState !== 'operational') throw new Error('Reporting actions are unavailable until this pool is operational.')
				const selectedSide = latestDetails.sides.find(side => side.key === outcome)
				if (selectedSide === undefined) {
					throw new Error('Unable to load deposits for the requested outcome side.')
				}
				const availableDepositIndexes = selectedSide?.userDeposits.map(deposit => deposit.depositIndex) ?? []

				if (latestDetails.settlementState === 'migration-required') throw new Error('Unresolved escalation deposits must migrate in Fork & Migration.')
				if (latestDetails.settlementState === 'migration-expired') throw new Error('The migration window for these unresolved escalation deposits has closed.')
				if (!latestDetails.parentWithdrawalEnabled) throw new Error('Escalation deposits cannot be settled until the question is finalized.')

				const requestedDepositIndexes = depositIndexesOverride ?? currentForm.selectedWithdrawDepositIndexesByOutcome[outcome]
				const missingSelectedDepositIndex = requestedDepositIndexes.find(index => !availableDepositIndexes.includes(index))
				if (missingSelectedDepositIndex !== undefined) {
					throw new Error(`Selected deposit #${missingSelectedDepositIndex.toString()} is no longer available to settle on ${selectedSide.label}.`)
				}

				const depositIndexes = requestedDepositIndexes
				if (depositIndexes.length === 0) {
					throw new Error('Select at least one deposit to settle or use Settle all for this side.')
				}

				return await withdrawEscalationFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), securityPoolAddress, outcome, depositIndexes)
			},
			'Failed to settle escalation deposits',
		)

	return {
		loadingReportingDetails: reportingLoad.isLoading.value,
		loadReporting,
		onReportOutcome: reportOutcome,
		reportingActiveAction: reportingActiveAction.value,
		reportingDetails: reportingDetails.value,
		reportingError: reportingError.value,
		reportingFeedback: reportingFeedback.value,
		reportingForm: reportingForm.value,
		reportingResult: reportingResult.value,
		setReportingForm,
		withdrawEscalation,
	}
}
