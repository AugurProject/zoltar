import { useSignal } from '@preact/signals'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import type { Address } from 'viem'
import { loadReportingDetails, reportOutcomeInSecurityPool, withdrawEscalationFromSecurityPool } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput } from '../lib/inputs.js'
import { getDefaultReportingFormState, parseRepAmountInput } from '../lib/marketForm.js'
import { previewReportingContribution } from '../lib/reportingDomain.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import type { ReportingFormState, WriteOperationsParameters } from '../types/app.js'
import type { ActionFeedback } from '../types/components.js'
import type { ReportingActionResult, ReportingDetails } from '../types/contracts.js'

type UseReportingOperationsParameters = WriteOperationsParameters

export function useReportingOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseReportingOperationsParameters) {
	const reportingLoad = useLoadController()
	const reportingDetails = useSignal<ReportingDetails | undefined>(undefined)
	const reportingError = useSignal<string | undefined>(undefined)
	const { state: reportingForm, setState: setReportingForm } = useFormState<ReportingFormState>(getDefaultReportingFormState())
	const reportingActiveAction = useSignal<ReportingActionResult['action'] | undefined>(undefined)
	const reportingFeedback = useSignal<ActionFeedback<ReportingActionResult['action']> | undefined>(undefined)
	const reportingResult = useSignal<ReportingActionResult | undefined>(undefined)
	const nextReportingLoad = useRequestGuard()

	const getPendingTitle = (actionName: ReportingActionResult['action']) => (actionName === 'reportOutcome' ? 'Submitting report' : 'Withdrawing escalation deposits')
	const getSuccessTitle = (actionName: ReportingActionResult['action']) => (actionName === 'reportOutcome' ? 'Report submitted' : 'Escalation deposits withdrawn')
	const getFailureTitle = (actionName: ReportingActionResult['action']) => (actionName === 'reportOutcome' ? 'Report failed' : 'Withdrawal failed')

	const loadReporting = async () => {
		const isCurrent = nextReportingLoad()
		await reportingLoad.run({
			isCurrent,
			onStart: () => {
				reportingError.value = undefined
			},
			load: async () => {
				const securityPoolAddress = parseAddressInput(reportingForm.value.securityPoolAddress, 'Security pool address')
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
					...buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, reportingError, 'Connect a wallet before reporting on a market'),
					onRefreshError: (message, hash) => {
						reportingFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
					},
					onWriteError: message => {
						reportingFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
					refreshErrorFallback: 'Reporting transaction succeeded, but refreshing reporting details failed',
				},
				async walletAddress => {
					reportingResult.value = undefined
					const securityPoolAddress = parseAddressInput(currentForm.securityPoolAddress, 'Security pool address')
					return await action(walletAddress, securityPoolAddress, currentForm)
				},
				errorFallback,
				async result => {
					reportingResult.value = result
					reportingFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash)
					const securityPoolAddress = parseAddressInput(currentForm.securityPoolAddress, 'Security pool address')
					const details = await loadReportingDetails(createConnectedReadClient(), securityPoolAddress, accountAddress)
					reportingDetails.value = details
					setReportingForm(current => {
						if (details.status !== 'active') {
							return current.selectedWithdrawDepositIndexes.length === 0 ? current : { ...current, selectedWithdrawDepositIndexes: [] }
						}
						const selectedSide = details.sides.find(side => side.key === current.selectedOutcome)
						const availableDepositIndexes = selectedSide?.userDeposits.map(deposit => deposit.depositIndex) ?? []
						const selectedWithdrawDepositIndexes = current.selectedWithdrawDepositIndexes.filter(index => availableDepositIndexes.includes(index))
						if (selectedWithdrawDepositIndexes.length === current.selectedWithdrawDepositIndexes.length) return current
						return {
							...current,
							selectedWithdrawDepositIndexes,
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
				const reportAmount = parseRepAmountInput(currentForm.reportAmount, 'Report amount')
				const latestDetails = await loadReportingDetails(createConnectedReadClient(), securityPoolAddress, walletAddress)
				const contributionPreview = previewReportingContribution(latestDetails, currentForm.selectedOutcome, reportAmount)
				if (contributionPreview.actualDepositAmount === undefined) {
					throw new Error(contributionPreview.reason ?? 'Unable to preview the REP that would be locked for this report.')
				}
				if (!latestDetails.viewerVaultExists) {
					throw new Error('Reporting locks REP already deposited in your security vault. Deposit REP into your vault before reporting.')
				}
				const availableVaultRep = latestDetails.viewerVaultAvailableEscalationRep ?? 0n
				if (contributionPreview.actualDepositAmount > availableVaultRep) {
					throw new Error(`Insufficient unlocked REP in your vault. Need ${formatCurrencyBalance(contributionPreview.actualDepositAmount - availableVaultRep)} more REP deposited and unlocked before reporting.`)
				}

				return await reportOutcomeInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, currentForm.selectedOutcome, reportAmount)
			},
			'Failed to report on outcome',
		)

	const withdrawEscalation = async () =>
		await runReportingAction(
			'withdrawEscalation',
			async (walletAddress, securityPoolAddress, currentForm) => {
				const latestDetails = await loadReportingDetails(createConnectedReadClient(), securityPoolAddress, walletAddress)
				if (latestDetails.status !== 'active') {
					throw new Error('Withdrawals are unavailable until the first report or contribution deploys the escalation game.')
				}
				const selectedSide = latestDetails.sides.find(side => side.key === currentForm.selectedOutcome)
				const availableDepositIndexes = selectedSide?.userDeposits.map(deposit => deposit.depositIndex) ?? []

				if (!latestDetails.withdrawalEnabled) {
					throw new Error('Escalation deposits cannot be withdrawn until the question is finalized or the game is canceled by an external fork.')
				}

				const missingSelectedDepositIndex = currentForm.selectedWithdrawDepositIndexes.find(index => !availableDepositIndexes.includes(index))
				if (missingSelectedDepositIndex !== undefined) {
					throw new Error(`Selected deposit #${missingSelectedDepositIndex.toString()} is no longer available to withdraw on the selected side`)
				}

				const depositIndexes = currentForm.selectedWithdrawDepositIndexes.length > 0 ? currentForm.selectedWithdrawDepositIndexes : availableDepositIndexes
				if (depositIndexes.length === 0) {
					throw new Error('No deposits available to withdraw for the selected side')
				}

				return await withdrawEscalationFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, currentForm.selectedOutcome, depositIndexes)
			},
			'Failed to withdraw escalation deposits',
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
